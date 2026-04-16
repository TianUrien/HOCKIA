import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { Plus, Edit2, Copy, Archive, MapPin, Calendar, Users, Eye, Rocket, Trash2, Loader2, MoreHorizontal, CheckCircle, AlertCircle, XCircle, Briefcase } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { useAuthStore } from '../lib/auth'
import { useToastStore } from '@/lib/toast'
import type { Vacancy } from '../lib/supabase'
import Button from './Button'
import CreateOpportunityModal from './CreateOpportunityModal'
import ApplyToOpportunityModal from './ApplyToOpportunityModal'
import OpportunityDetailView from './OpportunityDetailView'
import PublishConfirmationModal from './PublishConfirmationModal'
import DeleteOpportunityModal from './DeleteOpportunityModal'
import Skeleton, { OpportunityCardSkeleton } from './Skeleton'
import { reportSupabaseError } from '@/lib/sentryHelpers'

type VacancyWithCount = Vacancy & { applicant_count: number | null }

interface VacanciesTabProps {
  profileId?: string
  readOnly?: boolean
  triggerCreate?: boolean
  onCreateTriggered?: () => void
}

interface VacancyActionMenuProps {
  vacancy: Vacancy
  disabled?: boolean
  onEdit: (vacancy: Vacancy) => void
  onDuplicate: (vacancy: Vacancy) => void
  onPublish: (vacancy: Vacancy) => void
  onClose: (id: string) => void
  onDelete: (vacancy: Vacancy) => void
}

function VacancyActionMenu({ vacancy, disabled, onEdit, onDuplicate, onPublish, onClose, onDelete }: VacancyActionMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handleClick = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return
      }
      setOpen(false)
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const closeMenu = () => setOpen(false)

  const menuItems: Array<{ key: string; label: string; icon: ReactNode; onClick: () => void; tone?: 'danger' | 'primary' }> = []

  if (vacancy.status === 'draft') {
    menuItems.push({
      key: 'publish',
      label: 'Publish opportunity',
      icon: <Rocket className="w-4 h-4 text-green-600" />,
      onClick: () => {
        closeMenu()
        onPublish(vacancy)
      },
      tone: 'primary'
    })
  }

  if (vacancy.status === 'open') {
    menuItems.push({
      key: 'close',
      label: 'Close opportunity',
      icon: <Archive className="w-4 h-4 text-amber-600" />,
      onClick: () => {
        closeMenu()
        onClose(vacancy.id)
      },
      tone: 'danger'
    })
  }

  menuItems.push(
    {
      key: 'edit',
      label: 'Edit details',
      icon: <Edit2 className="w-4 h-4" />,
      onClick: () => {
        closeMenu()
        onEdit(vacancy)
      }
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: <Copy className="w-4 h-4" />,
      onClick: () => {
        closeMenu()
        onDuplicate(vacancy)
      }
    }
  )

  if (vacancy.status === 'closed' || vacancy.status === 'draft') {
    menuItems.push({
      key: 'delete',
      label: vacancy.status === 'draft' ? 'Delete draft' : 'Delete permanently',
      icon: <Trash2 className="w-4 h-4 text-red-600" />,
      onClick: () => {
        closeMenu()
        onDelete(vacancy)
      },
      tone: 'danger'
    })
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="Open opportunity menu"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:text-gray-900 disabled:opacity-50"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-3 w-56 rounded-2xl border border-gray-100 bg-white p-2 shadow-lg ring-1 ring-black/5">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-left transition hover:bg-gray-50 ${
                item.tone === 'danger'
                  ? 'text-red-600'
                  : item.tone === 'primary'
                  ? 'text-green-600'
                  : 'text-gray-700'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function VacanciesTab({ profileId, readOnly = false, triggerCreate, onCreateTriggered }: VacanciesTabProps) {
  const { user, profile } = useAuthStore()
  const targetUserId = profileId || user?.id
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({})
  const [userApplications, setUserApplications] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null)
  type VacancyAction = 'publish' | 'close' | 'delete' | 'duplicate'
  const [actionLoading, setActionLoading] = useState<{ id: string; action: VacancyAction } | null>(null)
  type StatusFilter = 'all' | 'draft' | 'open' | 'closed'
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Apply modal state
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  
  // Detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailVacancy, setDetailVacancy] = useState<Vacancy | null>(null)
  const [clubName, setClubName] = useState<string>('')
  const [clubLogo, setClubLogo] = useState<string | null>(null)
  
  // Publish confirmation modal state
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [vacancyToPublish, setVacancyToPublish] = useState<Vacancy | null>(null)
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [vacancyToDelete, setVacancyToDelete] = useState<Vacancy | null>(null)

  const fetchVacancies = useCallback(async () => {
    if (!targetUserId) return

    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .rpc('fetch_club_opportunities_with_counts', {
          p_club_id: targetUserId,
          p_include_closed: !readOnly,
          p_limit: 200
        })
        .returns<VacancyWithCount[]>()

      if (error) throw error

      const normalized = (data ?? []).map((row) => {
        const { applicant_count, ...vacancyFields } = row
        return {
          vacancy: vacancyFields as Vacancy,
          applicantCount: applicant_count ?? 0
        }
      })

      setVacancies(normalized.map((entry) => entry.vacancy))

      if (!readOnly && user?.id === targetUserId) {
        const counts: Record<string, number> = {}
        normalized.forEach((entry) => {
          counts[entry.vacancy.id] = entry.applicantCount
        })
        setApplicantCounts(counts)
      } else {
        setApplicantCounts({})
      }
    } catch (error) {
      logger.error('Error fetching vacancies:', error)
      reportSupabaseError('fetch_club_opportunities_with_counts', error)
      if (!readOnly) {
        addToast('Failed to load opportunities. Please refresh the page.', 'error')
      }
    } finally {
      setIsLoading(false)
    }
  }, [targetUserId, readOnly, user, addToast])

  // Fetch user's applications to check which vacancies they've applied to
  const fetchUserApplications = useCallback(async () => {
    if (!user || !readOnly) return // Only fetch when in readOnly mode (public view)

    try {
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select('opportunity_id')
        .eq('applicant_id', user.id)

      if (error) throw error
      
      const appliedVacancyIds = new Set(data?.map(app => app.opportunity_id) || [])
      setUserApplications(appliedVacancyIds)
    } catch (error) {
      logger.error('Error fetching user applications:', error)
    }
  }, [user, readOnly])

  useEffect(() => {
    if (targetUserId) {
      fetchVacancies()
      fetchUserApplications()
    }
  }, [targetUserId, fetchVacancies, fetchUserApplications])

  // Handle external trigger to create vacancy
  useEffect(() => {
    if (triggerCreate) {
      setShowModal(true)
      setEditingVacancy(null)
      onCreateTriggered?.()
    }
  }, [triggerCreate, onCreateTriggered])

  const handleApply = (vacancy: Vacancy) => {
    if (!user) {
      // Redirect to login with return URL
      const returnUrl = window.location.pathname
      navigate(`/signup?redirect=${encodeURIComponent(returnUrl)}`)
      return
    }

    setSelectedVacancy(vacancy)
    setShowApplyModal(true)
  }

  const canUserApply = (vacancy: Vacancy): boolean => {
    if (!user || !profile) return false
    
    // Check if user role matches vacancy type
    if (vacancy.opportunity_type === 'player' && profile.role !== 'player') return false
    if (vacancy.opportunity_type === 'coach' && profile.role !== 'coach') return false
    
    // Clubs cannot apply
    if (profile.role === 'club') return false
    
    return true
  }

  const handleViewDetails = async (vacancy: Vacancy) => {
    setDetailVacancy(vacancy)
    setShowDetailModal(true)

    // Fetch club details
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.fetch_club_profile',
        data: { clubId: vacancy.club_id },
        level: 'info'
      })
      const { data: clubData, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', vacancy.club_id)
        .single()

      if (error) {
        throw error
      }

      if (clubData) {
        setClubName(clubData.full_name || 'Unknown Club')
        setClubLogo(clubData.avatar_url)
      }
    } catch (error) {
      logger.error('Error fetching club details:', error)
      reportSupabaseError('vacancies.fetch_club_profile', error, {
        clubId: vacancy.club_id
      }, {
        feature: 'vacancies',
        operation: 'load_club_profile'
      })
      setClubName('Unknown Club')
    }
  }

  const handleCreateNew = () => {
    setEditingVacancy(null)
    setShowModal(true)
  }

  const handleEdit = (vacancy: Vacancy) => {
    setEditingVacancy(vacancy)
    setShowModal(true)
  }

  const handleDuplicate = async (vacancy: Vacancy) => {
    if (!user || actionLoading) return

    setActionLoading({ id: vacancy.id, action: 'duplicate' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, created_at, updated_at, published_at, closed_at, applicant_count, pending_count, ...duplicateData } = vacancy as Vacancy & { applicant_count?: number; pending_count?: number }
      
      const newVacancy = {
        ...duplicateData,
        club_id: user.id,
        title: `${vacancy.title} (Copy)`,
        status: 'draft' as const,
      }

      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.duplicate',
        data: { vacancyId: vacancy.id },
        level: 'info'
      })
      const { error } = await supabase
        .from('opportunities')
        .insert(newVacancy as never)

      if (error) throw error
      
      await fetchVacancies()
      addToast('Opportunity duplicated as draft.', 'success')
    } catch (error) {
      logger.error('Error duplicating vacancy:', error)
      reportSupabaseError('vacancies.duplicate', error, {
        vacancyId: vacancy.id
      }, {
        feature: 'vacancies',
        operation: 'duplicate_vacancy'
      })
      addToast('Failed to duplicate opportunity. Please try again.', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleClose = async (vacancyId: string) => {
    if (actionLoading) return
    
    setActionLoading({ id: vacancyId, action: 'close' })
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.close',
        data: { vacancyId },
        level: 'info'
      })
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'closed' } as never)
        .eq('id', vacancyId)

      if (error) throw error
      
      await fetchVacancies()
      addToast('Opportunity closed.', 'success')
    } catch (error) {
      logger.error('Error closing vacancy:', error)
      reportSupabaseError('vacancies.close', error, {
        vacancyId
      }, {
        feature: 'vacancies',
        operation: 'close_vacancy'
      })
      addToast('Failed to close opportunity. Please try again.', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePublishClick = (vacancy: Vacancy) => {
    setVacancyToPublish(vacancy)
    setShowPublishModal(true)
  }

  const handlePublish = async () => {
  if (actionLoading || !vacancyToPublish) return
    
  setActionLoading({ id: vacancyToPublish.id, action: 'publish' })
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.publish',
        data: { vacancyId: vacancyToPublish.id },
        level: 'info'
      })
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'open', published_at: new Date().toISOString() } as never)
        .eq('id', vacancyToPublish.id)

      if (error) throw error
      
      await fetchVacancies()
      
      // Close modal and show success toast
      setShowPublishModal(false)
      setVacancyToPublish(null)
      addToast('Opportunity published successfully!', 'success')
    } catch (error) {
      logger.error('Error publishing vacancy:', error)
      reportSupabaseError('vacancies.publish', error, {
        vacancyId: vacancyToPublish.id
      }, {
        feature: 'vacancies',
        operation: 'publish_vacancy'
      })
      addToast('Failed to publish opportunity. Please try again.', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteClick = (vacancy: Vacancy) => {
    setVacancyToDelete(vacancy)
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
  if (actionLoading || !vacancyToDelete) return
    
  setActionLoading({ id: vacancyToDelete.id, action: 'delete' })
    try {
      // Delete the vacancy (cascade will handle applications)
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.delete',
        data: { vacancyId: vacancyToDelete.id },
        level: 'warning'
      })
      const { error } = await supabase
        .from('opportunities')
        .delete()
        .eq('id', vacancyToDelete.id)

      if (error) throw error
      
      // Refresh vacancies list
      await fetchVacancies()
      
      // Close modal
      setShowDeleteModal(false)
      setVacancyToDelete(null)
      addToast('Opportunity deleted.', 'success')
    } catch (error) {
      logger.error('Error deleting vacancy:', error)
      reportSupabaseError('vacancies.delete', error, {
        vacancyId: vacancyToDelete?.id
      }, {
        feature: 'vacancies',
        operation: 'delete_vacancy'
      })
      addToast('Failed to delete opportunity. Please try again.', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const getStatusBadge = (status: Vacancy['status']) => {
    if (!status) return null

    const config: Record<string, { style: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
      draft: { style: 'bg-amber-50 text-amber-700 border border-amber-200', icon: AlertCircle, label: 'Draft' },
      open: { style: 'bg-[#8026FA]/5 text-[#8026FA] border border-[#8026FA]/15', icon: CheckCircle, label: 'Published' },
      closed: { style: 'bg-gray-100 text-gray-500 border border-gray-200', icon: XCircle, label: 'Closed' },
    }

    const { style, icon: Icon, label } = config[status] || config.draft

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${style}`}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'TBD'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white/80 px-4 py-4">
          <div className="space-y-2">
            <Skeleton width={120} height={16} />
            <Skeleton width={200} height={28} />
            <Skeleton width={160} height={14} />
          </div>
          {!readOnly && <Skeleton width={90} height={36} className="rounded-full" />}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <OpportunityCardSkeleton key={index} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-gray-900">
              {readOnly ? 'Open Opportunities' : 'Manage Opportunities'}
            </h2>
            <p className="text-sm text-gray-500">
              {readOnly
                ? `${vacancies.length} live role${vacancies.length === 1 ? '' : 's'}`
                : `${vacancies.length} total opportunit${vacancies.length === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={handleCreateNew}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          )}
        </div>

        {/* Status Filter Tabs (owner only) */}
        {!readOnly && vacancies.length > 0 && (
          <div className="flex gap-1 border-t border-gray-100 pt-3">
            {([
              { key: 'all' as StatusFilter, label: 'All' },
              { key: 'draft' as StatusFilter, label: 'Drafts' },
              { key: 'open' as StatusFilter, label: 'Published' },
              { key: 'closed' as StatusFilter, label: 'Closed' },
            ]).map(({ key, label }) => {
              const count = key === 'all' ? vacancies.length : vacancies.filter(v => v.status === key).length
              if (key !== 'all' && count === 0) return null
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === key
                      ? 'bg-[#8026FA]/10 text-[#8026FA]'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 text-xs ${statusFilter === key ? 'text-[#8026FA]/60' : 'text-gray-400'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Empty State */}
      {vacancies.length === 0 && !readOnly && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#8026FA]/10">
              <Briefcase className="w-8 h-8 text-[#8026FA]" />
            </div>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">No Opportunities Yet</h3>
          <p className="mb-6 text-gray-600">
            Create your first opportunity to start attracting talent to your club
          </p>
          <Button
            onClick={handleCreateNew}
            className="mx-auto flex items-center gap-2 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Create First Opportunity
          </Button>
        </div>
      )}

      {vacancies.length === 0 && readOnly && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
              <span className="text-2xl">👀</span>
            </div>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">No Open Opportunities</h3>
          <p className="text-sm text-gray-600">
            This club hasn’t posted any openings yet. Check back soon or follow them to stay updated.
          </p>
        </div>
      )}

      {/* Vacancies Grid */}
      {vacancies.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {vacancies.filter(v => statusFilter === 'all' || v.status === statusFilter).map((vacancy) => {
            const locationLabel = [vacancy.location_city, vacancy.location_country].filter(Boolean).join(', ')

            // Compound badge: "Player · Men's · Forward" (same pattern as public cards)
            const badgeParts: string[] = []
            badgeParts.push(vacancy.opportunity_type === 'player' ? 'Player' : 'Coach')
            if (vacancy.opportunity_type === 'player' && vacancy.gender) {
              badgeParts.push(vacancy.gender === 'Men' ? "Men's" : "Women's")
            }
            if (vacancy.position) {
              badgeParts.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
            }
            const roleBadgeStyle = vacancy.opportunity_type === 'player'
              ? 'bg-[#EFF6FF] text-[#2563EB]'
              : 'bg-[#F0FDFA] text-[#0D9488]'

            return (
              <div
                key={vacancy.id}
                onClick={() => handleViewDetails(vacancy)}
                className="rounded-xl border border-gray-200 bg-white p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 group"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#8026FA] transition-colors">{vacancy.title}</h3>
                    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold ${roleBadgeStyle}`}>
                      {badgeParts.join(' · ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {getStatusBadge(vacancy.status)}
                    {!readOnly && (
                      <VacancyActionMenu
                        vacancy={vacancy}
                        disabled={Boolean(actionLoading)}
                        onEdit={handleEdit}
                        onDuplicate={handleDuplicate}
                        onPublish={handlePublishClick}
                        onClose={handleClose}
                        onDelete={handleDeleteClick}
                      />
                    )}
                  </div>
                </div>

                {/* Details - single location + date row */}
                <div className="mt-3 flex items-center flex-wrap gap-x-3 gap-y-1 text-[13px] text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{locationLabel || 'Location TBD'}</span>
                  </div>
                  <span className="text-gray-300">·</span>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{vacancy.start_date ? formatDate(vacancy.start_date) : 'Start TBD'}</span>
                  </div>
                </div>

                {/* Applicants pill */}
                {!readOnly && (vacancy.status === 'open' || vacancy.status === 'closed') && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/opportunities/${vacancy.id}/applicants`) }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                    {applicantCounts[vacancy.id] || 0} applicant{applicantCounts[vacancy.id] === 1 ? '' : 's'}
                  </button>
                )}

                {/* Draft hint */}
                {!readOnly && vacancy.status === 'draft' && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    Draft — publish when you're ready to go live.
                  </p>
                )}

                {/* Public actions */}
                {readOnly && (
                  <div className="mt-5 flex items-center gap-3 border-t border-gray-100 pt-4">
                    {!user ? (
                      <button
                        type="button"
                        onClick={() => handleApply(vacancy)}
                        className="flex-1 rounded-2xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/30"
                      >
                        Sign in to apply
                      </button>
                    ) : userApplications.has(vacancy.id) ? (
                      <button
                        type="button"
                        disabled
                        className="flex-1 rounded-2xl border border-[#e3d6ff] bg-gradient-to-r from-[#ede8ff] via-[#f6edff] to-[#fbf2ff] px-4 py-3 text-sm font-semibold text-[#7c3aed] shadow-[0_12px_30px_rgba(124,58,237,0.18)]"
                      >
                        ✓ Applied
                      </button>
                    ) : canUserApply(vacancy) ? (
                      <button
                        type="button"
                        onClick={() => handleApply(vacancy)}
                        className="flex-1 rounded-2xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/30"
                      >
                        Apply now
                      </button>
                    ) : (
                      <div className="flex-1 rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-center text-xs font-medium text-gray-500">
                        {vacancy.opportunity_type === 'player'
                          ? 'Players only'
                          : 'Coaches only'}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleViewDetails(vacancy)}
                      className="rounded-2xl border border-gray-200 p-3 text-gray-500 transition hover:bg-gray-50"
                      aria-label="View opportunity details"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                  </div>
                )}

                {/* Loading indicators for menu-triggered actions */}
                {!readOnly && actionLoading?.id === vacancy.id && (
                  <div className="mt-4 flex items-center gap-2 text-xs font-medium text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {actionLoading.action === 'publish' && 'Publishing opportunity...'}
                    {actionLoading.action === 'close' && 'Closing opportunity...'}
                    {actionLoading.action === 'delete' && 'Deleting opportunity...'}
                    {actionLoading.action === 'duplicate' && 'Duplicating opportunity...'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <CreateOpportunityModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false)
          setEditingVacancy(null)
        }}
        onSuccess={() => {
          fetchVacancies()
          if (!editingVacancy) setStatusFilter('draft')
        }}
        editingVacancy={editingVacancy}
      />

      {/* Apply Modal */}
      {selectedVacancy && (
        <ApplyToOpportunityModal
          isOpen={showApplyModal}
          onClose={() => {
            setShowApplyModal(false)
            setSelectedVacancy(null)
          }}
          vacancy={selectedVacancy}
          onSuccess={(vacancyId) => {
            setUserApplications(prev => new Set([...prev, vacancyId]))
          }}
          onError={(vacancyId) => {
            setUserApplications(prev => {
              const next = new Set(prev)
              next.delete(vacancyId)
              return next
            })
          }}
        />
      )}

      {/* Vacancy Detail Modal */}
      {detailVacancy && showDetailModal && (
        <OpportunityDetailView
          vacancy={detailVacancy}
          clubName={clubName}
          clubLogo={clubLogo}
          clubId={detailVacancy.club_id}
          onClose={() => {
            setShowDetailModal(false)
            setDetailVacancy(null)
          }}
          onApply={
            user && (profile?.role === 'player' || profile?.role === 'coach') && canUserApply(detailVacancy)
              ? () => {
                  setShowDetailModal(false)
                  setSelectedVacancy(detailVacancy)
                  setShowApplyModal(true)
                }
              : undefined
          }
          hasApplied={userApplications.has(detailVacancy.id)}
          hideClubProfileButton={true}
        />
      )}

      {/* Publish Confirmation Modal */}
      {vacancyToPublish && (
        <PublishConfirmationModal
          isOpen={showPublishModal}
          onClose={() => {
            setShowPublishModal(false)
            setVacancyToPublish(null)
          }}
          onConfirm={handlePublish}
          vacancyTitle={vacancyToPublish.title}
          isLoading={actionLoading?.id === vacancyToPublish.id && actionLoading.action === 'publish'}
        />
      )}

      {/* Delete Confirmation Modal */}
      {vacancyToDelete && (
        <DeleteOpportunityModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false)
            setVacancyToDelete(null)
          }}
          onConfirm={handleDelete}
          vacancyTitle={vacancyToDelete.title}
          isLoading={actionLoading?.id === vacancyToDelete.id && actionLoading.action === 'delete'}
          isDraft={vacancyToDelete.status === 'draft'}
        />
      )}
    </div>
  )
}
