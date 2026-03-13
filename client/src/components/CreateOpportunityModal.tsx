import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X, Plus, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, CreditCard, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { useAuthStore } from '../lib/auth'
import type { Vacancy, VacancyInsert } from '../lib/supabase'
import Button from './Button'
import CountryNameSelect from './CountryNameSelect'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackVacancyCreate } from '@/lib/analytics'

interface CreateVacancyModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editingVacancy?: Vacancy | null
}

const BENEFIT_OPTIONS = [
  { id: 'housing', label: 'Housing', icon: Home },
  { id: 'car', label: 'Car', icon: Car },
  { id: 'visa', label: 'Visa', icon: GlobeIcon },
  { id: 'flights', label: 'Flights', icon: Plane },
  { id: 'meals', label: 'Meals', icon: Utensils },
  { id: 'job', label: 'Job', icon: Briefcase },
  { id: 'insurance', label: 'Insurance', icon: Shield },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'bonuses', label: 'Bonuses', icon: CreditCard },
  { id: 'equipment', label: 'Equipment', icon: Trophy },
]

const buildInitialFormData = (vacancy?: Vacancy | null): Partial<VacancyInsert> => ({
  opportunity_type: vacancy?.opportunity_type || 'player',
  title: vacancy?.title || '',
  position: vacancy?.position || undefined,
  gender: vacancy?.gender || undefined,
  description: vacancy?.description || '',
  location_city: vacancy?.location_city || '',
  location_country: vacancy?.location_country || '',
  start_date: vacancy?.start_date || null,
  duration_text: vacancy?.duration_text || '',
  requirements: vacancy?.requirements || [],
  benefits: vacancy?.benefits || [],
  custom_benefits: vacancy?.custom_benefits || [],
  priority: vacancy?.priority || 'medium',
  status: vacancy?.status || 'draft',
  application_deadline: vacancy?.application_deadline || null,
  contact_email: vacancy?.contact_email || '',
  contact_phone: vacancy?.contact_phone || '',
  organization_name: vacancy?.organization_name || '',
})

const getVacancyDraftKey = (profileId: string) => `vacancyDraft:new:${profileId}`

type VacancyDraftStorage = {
  formData: Partial<VacancyInsert>
  newRequirement: string
  newCustomBenefit: string
}

export default function CreateVacancyModal({ isOpen, onClose, onSuccess, editingVacancy }: CreateVacancyModalProps) {
  const { user, profile } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { addToast } = useToastStore()

  const [formData, setFormData] = useState<Partial<VacancyInsert>>(buildInitialFormData(editingVacancy))

  const [newRequirement, setNewRequirement] = useState('')
  const [newCustomBenefit, setNewCustomBenefit] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const opportunityTypeRef = useRef<HTMLSelectElement | null>(null)
  const titleId = useId()
  const subtitleId = useId()
  const opportunityTypeFieldId = useId()
  const priorityFieldId = useId()
  const opportunityTitleFieldId = useId()
  const descriptionFieldId = useId()
  const locationCityFieldId = useId()
  const startDateFieldId = useId()
  const durationFieldId = useId()
  const applicationDeadlineFieldId = useId()
  const contactEmailFieldId = useId()
  const contactPhoneFieldId = useId()
  const newRequirementFieldId = useId()
  const newCustomBenefitFieldId = useId()
  const organizationNameFieldId = useId()
  const vacancyDraftSaveTimeoutRef = useRef<number | null>(null)
  const vacancyDraftRestoringRef = useRef(false)

  const clearVacancyDraft = useCallback(() => {
    if (typeof window === 'undefined' || !user) return
    const draftKey = getVacancyDraftKey(user.id)
    window.localStorage.removeItem(draftKey)
  }, [user])

  const handleClose = useCallback(() => {
    if (isLoading) {
      return
    }
    if (!editingVacancy) {
      clearVacancyDraft()
    }
    onClose()
  }, [clearVacancyDraft, editingVacancy, isLoading, onClose])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: opportunityTypeRef })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setErrors({})
    setNewRequirement('')
    setNewCustomBenefit('')

    if (!editingVacancy && user && typeof window !== 'undefined') {
      const draftKey = getVacancyDraftKey(user.id)
      const rawDraft = window.localStorage.getItem(draftKey)
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as VacancyDraftStorage
          const base = buildInitialFormData(null)
          setFormData({ ...base, ...(parsed.formData || {}) })
          setNewRequirement(parsed.newRequirement ?? '')
          setNewCustomBenefit(parsed.newCustomBenefit ?? '')
          vacancyDraftRestoringRef.current = true
          addToast('Opportunity draft restored.', 'info')
          return
        } catch (error) {
          logger.error('Failed to restore vacancy draft', error)
          window.localStorage.removeItem(draftKey)
        }
      }
    }

    const initial = buildInitialFormData(editingVacancy)
    // Pre-fill organization name from coach's current club for new opportunities
    if (!editingVacancy && profile?.role === 'coach' && profile.current_club && !initial.organization_name) {
      initial.organization_name = profile.current_club
    }
    setFormData(initial)
  }, [addToast, editingVacancy, isOpen, profile, user])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    // Lock body scroll when modal is open
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [handleClose, isOpen])

  useEffect(() => {
    if (!isOpen || editingVacancy || !user) {
      if (vacancyDraftSaveTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
        vacancyDraftSaveTimeoutRef.current = null
      }
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    if (vacancyDraftRestoringRef.current) {
      vacancyDraftRestoringRef.current = false
      return
    }

    if (vacancyDraftSaveTimeoutRef.current) {
      window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
      vacancyDraftSaveTimeoutRef.current = null
    }

    vacancyDraftSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        const payload: VacancyDraftStorage = {
          formData,
          newRequirement,
          newCustomBenefit,
        }
        window.localStorage.setItem(getVacancyDraftKey(user.id), JSON.stringify(payload))
      } catch (error) {
        logger.error('Failed to persist vacancy draft', error)
      } finally {
        vacancyDraftSaveTimeoutRef.current = null
      }
    }, 600)
  }, [editingVacancy, formData, isOpen, newCustomBenefit, newRequirement, user])

  useEffect(() => {
    return () => {
      if (vacancyDraftSaveTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
        vacancyDraftSaveTimeoutRef.current = null
      }
    }
  }, [])

  if (!isOpen) return null

  const handleInputChange = (field: keyof VacancyInsert, value: VacancyInsert[typeof field]) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'opportunity_type' && value === 'coach') {
        next.position = undefined  // reset — coach has different position options
        next.gender = undefined
      }
      return next
    })

    setErrors(prevErrors => {
      if (field === 'opportunity_type' && value === 'coach') {
        if (!prevErrors.position && !prevErrors.gender && !prevErrors[field]) {
          return prevErrors
        }
        const updated = { ...prevErrors }
        delete updated.position
        delete updated.gender
        delete updated[field]
        return updated
      }

      if (prevErrors[field]) {
        const updated = { ...prevErrors }
        delete updated[field]
        return updated
      }

      return prevErrors
    })
  }

  const toggleBenefit = (benefitId: string) => {
    const currentBenefits = formData.benefits || []
    const newBenefits = currentBenefits.includes(benefitId)
      ? currentBenefits.filter(b => b !== benefitId)
      : [...currentBenefits, benefitId]
    handleInputChange('benefits', newBenefits)
  }

  const addRequirement = () => {
    if (newRequirement.trim()) {
      handleInputChange('requirements', [...(formData.requirements || []), newRequirement.trim()])
      setNewRequirement('')
    }
  }

  const removeRequirement = (index: number) => {
    handleInputChange('requirements', (formData.requirements || []).filter((_, i) => i !== index))
  }

  const addCustomBenefit = () => {
    if (newCustomBenefit.trim()) {
      handleInputChange('custom_benefits', [...(formData.custom_benefits || []), newCustomBenefit.trim()])
      setNewCustomBenefit('')
    }
  }

  const removeCustomBenefit = (index: number) => {
    handleInputChange('custom_benefits', (formData.custom_benefits || []).filter((_, i) => i !== index))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.title?.trim()) newErrors.title = 'Title is required'
    // Only validate position and gender for player opportunities
    if (formData.opportunity_type === 'player') {
      if (!formData.position) newErrors.position = 'Position is required'
      if (!formData.gender) newErrors.gender = 'Gender is required'
    }
    if (!formData.location_city?.trim()) newErrors.location_city = 'City is required'
    if (!formData.location_country?.trim()) newErrors.location_country = 'Country is required'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!user) {
      addToast('You need to be signed in to manage opportunities.', 'error')
      return
    }

    if (!validate()) {
      addToast('Please fix the highlighted fields before saving.', 'error')
      return
    }

    setIsLoading(true)
    try {
      const vacancyData: Partial<VacancyInsert> = {
        club_id: user.id,
        opportunity_type: formData.opportunity_type || 'player',
        title: formData.title!,
        position: formData.position || null,
        gender: formData.opportunity_type === 'player' ? formData.gender! : null,
        description: formData.description || null,
        location_city: formData.location_city!,
        location_country: formData.location_country!,
        start_date: formData.start_date || null,
        duration_text: formData.duration_text || null,
        requirements: formData.requirements || [],
        benefits: formData.benefits || [],
        custom_benefits: formData.custom_benefits || [],
        priority: formData.priority || 'medium',
        status: formData.status || 'draft',
        application_deadline: formData.application_deadline || null,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        organization_name: formData.organization_name?.trim() || null,
        world_club_id: profile?.role === 'coach' ? profile.current_world_club_id ?? null : null,
      }

      if (editingVacancy) {
        // Update existing opportunity
        const { error } = await supabase
          .from('opportunities')
          .update(vacancyData as never)
          .eq('id', editingVacancy.id)

        if (error) throw error
        const isStillDraft = (vacancyData.status || editingVacancy.status) === 'draft'
        if (isStillDraft) {
          addToast('Draft updated — publish when you\'re ready to go live.', 'info')
        } else {
          addToast('Opportunity updated successfully.', 'success')
        }
      } else {
        // Create new opportunity
        const { error } = await supabase
          .from('opportunities')
          .insert(vacancyData as never)

        if (error) throw error
        trackDbEvent('opportunity_create', 'vacancy', undefined, { type: vacancyData.opportunity_type })
        trackVacancyCreate(vacancyData.position || vacancyData.opportunity_type || 'unknown')
        addToast('Draft saved — publish when you\'re ready to go live.', 'info')
        clearVacancyDraft()
      }

      onSuccess()
      onClose()
    } catch (error) {
      logger.error('Error saving vacancy:', error)
      addToast('Failed to save opportunity. Please try again.', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const benefitsCount = (formData.benefits || []).length
  const benefitsPercentage = Math.round((benefitsCount / BENEFIT_OPTIONS.length) * 100)
  const titleErrorId = errors.title ? `${opportunityTitleFieldId}-error` : undefined
  const hasLocationError = Boolean(errors.location_city || errors.location_country)
  const locationErrorId = hasLocationError ? `${locationCityFieldId}-error` : undefined
  const locationAccessibilityProps = hasLocationError
    ? { 'aria-invalid': 'true' as const, 'aria-describedby': locationErrorId }
    : {}

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-gray-700" />
            </div>
            <div>
              <h2 id={titleId} className="text-xl font-bold text-gray-900">
                {editingVacancy ? 'Edit Opportunity' : 'Create New Opportunity'}
              </h2>
              <p id={subtitleId} className="text-sm text-gray-600">
                {editingVacancy 
                  ? 'Update your opportunity details' 
                  : formData.opportunity_type === 'player'
                    ? 'Create a new player position opportunity'
                    : 'Create a new coaching position opportunity'
                }
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Information */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5 text-gray-700" />
              <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Opportunity Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={opportunityTypeFieldId}>
                    Opportunity Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    id={opportunityTypeFieldId}
                    ref={opportunityTypeRef}
                    value={formData.opportunity_type}
                    onChange={(e) => handleInputChange('opportunity_type', e.target.value as 'player' | 'coach')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                    title="Opportunity type"
                  >
                    <option value="player">Player Position</option>
                    <option value="coach">Coach Position</option>
                  </select>
                </div>

                {/* Priority Level */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={priorityFieldId}>
                    Priority Level
                  </label>
                  <select
                    id={priorityFieldId}
                    value={formData.priority || ''}
                    onChange={(e) => handleInputChange('priority', e.target.value as 'low' | 'medium' | 'high')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                    title="Priority level"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              {/* Opportunity Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={opportunityTitleFieldId}>
                  Opportunity Title <span className="text-red-500">*</span>
                </label>
                <input
                  id={opportunityTitleFieldId}
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent ${
                    errors.title ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder={
                    formData.opportunity_type === 'player' 
                      ? "e.g., Elite Youth Player Opportunity"
                      : "e.g., Head Coach - Youth Development"
                  }
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={titleErrorId}
                  autoCapitalize="words"
                  inputMode="text"
                />
                {errors.title && <p id={titleErrorId} className="mt-1 text-sm text-red-600">{errors.title}</p>}
              </div>

              {/* Organization Name - shown for coaches, optional for clubs */}
              {profile?.role === 'coach' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={organizationNameFieldId}>
                  Organization / On behalf of
                </label>
                <input
                  id={organizationNameFieldId}
                  type="text"
                  value={formData.organization_name ?? ''}
                  onChange={(e) => handleInputChange('organization_name', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="e.g., Melbourne Hockey Club, Youth Academy"
                  autoCapitalize="words"
                  inputMode="text"
                />
                <p className="mt-1 text-xs text-gray-500">
                  The club, academy, or organization this opportunity is for. Shown on the card so applicants know who is hiring.
                </p>
              </div>
              )}

              {/* Position and Gender */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
                {/* Position */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Position {formData.opportunity_type === 'player' && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    value={formData.position || ''}
                    onChange={(e) => handleInputChange('position', e.target.value || undefined)}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white ${
                      errors.position ? 'border-red-500' : 'border-gray-300'
                    }`}
                    title="Position"
                  >
                    <option value="">Select position</option>
                    {formData.opportunity_type === 'player' ? (
                      <>
                        <option value="goalkeeper">Goalkeeper</option>
                        <option value="defender">Defender</option>
                        <option value="midfielder">Midfielder</option>
                        <option value="forward">Forward</option>
                      </>
                    ) : (
                      <>
                        <option value="head_coach">Head Coach</option>
                        <option value="assistant_coach">Assistant Coach</option>
                        <option value="youth_coach">Youth Coach</option>
                      </>
                    )}
                  </select>
                  {errors.position && <p className="mt-1 text-sm text-red-600">{errors.position}</p>}
                </div>

                {/* Gender - Only for player opportunities */}
                {formData.opportunity_type === 'player' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gender <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => handleInputChange('gender', e.target.value as 'Men' | 'Women')}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white ${
                      errors.gender ? 'border-red-500' : 'border-gray-300'
                    }`}
                    title="Gender"
                  >
                    <option value="">Select gender</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                  </select>
                  {errors.gender && <p className="mt-1 text-sm text-red-600">{errors.gender}</p>}
                </div>
                )}
              </div>

              {/* Description */}
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={descriptionFieldId}>
                  Description
                </label>
                <textarea
                  id={descriptionFieldId}
                  value={formData.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                  placeholder={
                    formData.opportunity_type === 'player'
                      ? "Describe the player opportunity, training environment, and development pathway..."
                      : "Describe the coaching role, responsibilities, and team environment..."
                  }
                />
              </div>
            </div>
          </section>

          {/* Location & Timeline */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <GlobeIcon className="w-5 h-5 text-gray-700" />
              <h3 className="text-lg font-semibold text-gray-900">Location & Timeline</h3>
            </div>

            <div className="space-y-4">
              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label htmlFor={locationCityFieldId} className="sr-only">
                    City
                  </label>
                  <input
                    id={locationCityFieldId}
                    type="text"
                    value={formData.location_city}
                    onChange={(e) => handleInputChange('location_city', e.target.value)}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent ${
                      errors.location_city ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="City"
                    autoCapitalize="words"
                    inputMode="text"
                    {...locationAccessibilityProps}
                  />
                  <CountryNameSelect
                    value={formData.location_country || null}
                    onChange={(countryName) => handleInputChange('location_country', countryName || '')}
                    placeholder="Select country"
                    required
                    error={errors.location_country}
                  />
                </div>
                {(errors.location_city || errors.location_country) && (
                  <p id={locationErrorId} className="mt-1 text-sm text-red-600">Both city and country are required</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={startDateFieldId}>
                    Start Date
                  </label>
                  <input
                    id={startDateFieldId}
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => handleInputChange('start_date', e.target.value || null)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={durationFieldId}>
                    Duration
                  </label>
                  <input
                    id={durationFieldId}
                    type="text"
                    value={formData.duration_text || ''}
                    onChange={(e) => handleInputChange('duration_text', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="e.g., 12 months"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Requirements */}
          <section className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Requirements</h3>
            
            <div className="space-y-3">
              {(formData.requirements || []).map((req, index) => (
                <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <span className="flex-1 text-sm text-gray-700">{req}</span>
                  <button
                    onClick={() => removeRequirement(index)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Remove requirement"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              {(!formData.requirements || formData.requirements.length === 0) && (
                <p className="text-sm text-gray-500 italic py-2">
                  {formData.opportunity_type === 'player'
                    ? "e.g., Minimum 3 years competitive experience, U18 age group"
                    : "e.g., UEFA B coaching license, 5+ years coaching experience"
                  }
                </p>
              )}

              <div className="flex gap-2">
                <label htmlFor={newRequirementFieldId} className="sr-only">
                  Add requirement
                </label>
                <input
                  id={newRequirementFieldId}
                  type="text"
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addRequirement()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="Add a requirement..."
                />
                <button
                  onClick={addRequirement}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Requirement
                </button>
              </div>
            </div>
          </section>

          {/* Benefits Package */}
          <section className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Benefits Package</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {BENEFIT_OPTIONS.map((benefit) => {
                const Icon = benefit.icon
                const isSelected = (formData.benefits || []).includes(benefit.id)
                
                return (
                  <button
                    key={benefit.id}
                    onClick={() => toggleBenefit(benefit.id)}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-[#10b981] bg-green-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2 ${
                      isSelected ? 'bg-[#10b981]' : 'bg-gray-200'
                    }`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <p className="text-sm font-medium text-gray-900 text-center">{benefit.label}</p>
                    <p className={`text-xs mt-1 text-center ${
                      isSelected ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {isSelected ? '✓ Included' : '✗ Not included'}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* Benefits Summary */}
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  • {benefitsCount} benefits included
                </span>
                <span className="text-sm font-medium text-gray-700">{benefitsPercentage}%</span>
              </div>
              <progress
                value={benefitsCount}
                max={BENEFIT_OPTIONS.length}
                className="w-full h-2 appearance-none rounded-full bg-gray-200 overflow-hidden [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-gray-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[#10b981] [&::-moz-progress-bar]:bg-[#10b981]"
                aria-valuetext={`${benefitsPercentage}% of benefits included`}
              />
            </div>
          </section>

          {/* Additional Custom Benefits */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">💡</span>
              <h3 className="text-lg font-semibold text-gray-900">Additional Custom Benefits</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(formData.custom_benefits || []).map((benefit, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                  >
                    {benefit}
                    <button
                      onClick={() => removeCustomBenefit(index)}
                      className="hover:text-purple-900"
                      aria-label="Remove benefit"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <label htmlFor={newCustomBenefitFieldId} className="sr-only">
                  Add custom benefit
                </label>
                <input
                  id={newCustomBenefitFieldId}
                  type="text"
                  value={newCustomBenefit}
                  onChange={(e) => setNewCustomBenefit(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomBenefit()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="e.g., Professional coaching and skill development"
                />
                <button
                  onClick={addCustomBenefit}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Custom Benefit
                </button>
              </div>
            </div>
          </section>

          {/* Application Details */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📅</span>
              <h3 className="text-lg font-semibold text-gray-900">Application Details</h3>
            </div>

            <div className="space-y-4">
              {/* Application Deadline */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={applicationDeadlineFieldId}>
                  Application Deadline
                </label>
                <input
                  id={applicationDeadlineFieldId}
                  type="date"
                  value={formData.application_deadline || ''}
                  onChange={(e) => handleInputChange('application_deadline', e.target.value || null)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={contactEmailFieldId}>
                    Contact Email
                  </label>
                  <input
                    id={contactEmailFieldId}
                    type="email"
                    value={formData.contact_email || ''}
                    onChange={(e) => handleInputChange('contact_email', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="info@elitehockeyacademy.com"
                    inputMode="email"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={contactPhoneFieldId}>
                    Contact Phone
                  </label>
                  <input
                    id={contactPhoneFieldId}
                    type="tel"
                    value={formData.contact_phone || ''}
                    onChange={(e) => handleInputChange('contact_phone', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="+31 20 123 4567"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="px-6 py-3 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="flex items-center gap-2 bg-[#10b981] hover:bg-[#059669]"
          >
            {isLoading ? 'Saving...' : editingVacancy ? 'Update Opportunity' : 'Create Opportunity'}
          </Button>
        </div>
      </div>
    </div>
  )
}
