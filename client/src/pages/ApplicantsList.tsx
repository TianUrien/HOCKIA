import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Star, HelpCircle, XCircle, Inbox } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import type { OpportunityApplicationWithApplicant, Opportunity, Json } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import ApplicantCard from '@/components/ApplicantCard'
import type { ApplicantReferenceInfo } from '@/components/ApplicantCard'
import { logger } from '@/lib/logger'

type ApplicationStatus = Database['public']['Enums']['application_status']

interface TierGroup {
  key: string
  label: string
  icon: typeof Star
  iconClass: string
  statuses: ApplicationStatus[]
}

const TIER_GROUPS: TierGroup[] = [
  { key: 'unsorted', label: 'Unsorted', icon: Inbox, iconClass: 'text-gray-400', statuses: ['pending'] },
  { key: 'shortlisted', label: 'Good fit', icon: Star, iconClass: 'text-emerald-600', statuses: ['shortlisted'] },
  { key: 'maybe', label: 'Maybe', icon: HelpCircle, iconClass: 'text-amber-600', statuses: ['maybe'] },
  { key: 'not-a-fit', label: 'Not a fit', icon: XCircle, iconClass: 'text-red-500', statuses: ['rejected'] },
]

export default function ApplicantsList() {
  const { opportunityId } = useParams<{ opportunityId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [applications, setApplications] = useState<OpportunityApplicationWithApplicant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [referenceMap, setReferenceMap] = useState<Map<string, ApplicantReferenceInfo>>(new Map())
  const [referencesUnavailable, setReferencesUnavailable] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      if (!opportunityId || !user) return

      setIsLoading(true)
      setError(null)

      try {
        // Fetch opportunity details
        const { data: opportunityData, error: opportunityError } = await supabase
          .from('opportunities')
          .select('*')
          .eq('id', opportunityId)
          .eq('club_id', user.id) // Ensure club owns this opportunity
          .single()

        if (opportunityError) {
          if (opportunityError.code === 'PGRST116') {
            setError('Opportunity not found or you do not have permission to view it.')
          } else {
            throw opportunityError
          }
          return
        }

        setOpportunity(opportunityData)

        // Fetch applications with applicant profiles
        const { data: applicationsData, error: applicationsError } = await supabase
          .from('opportunity_applications')
          .select(`
            *,
            applicant:applicant_id (
              id,
              full_name,
              avatar_url,
              position,
              secondary_position,
              base_location,
              nationality,
              username
            )
          `)
          .eq('opportunity_id', opportunityId)
          .order('applied_at', { ascending: false })

        if (applicationsError) {
          throw applicationsError
        }

        // Transform the data to match our type
        interface ApplicationWithProfile {
          id: string
          opportunity_id: string
          applicant_id: string
          cover_letter: string | null
          status: string
          applied_at: string
          updated_at: string
          metadata: Json
          applicant: {
            id: string
            full_name: string
            avatar_url: string | null
            position: string | null
            secondary_position: string | null
            base_location: string
            nationality: string
            username: string | null
          }
        }

        const transformedApplications: OpportunityApplicationWithApplicant[] = (applicationsData as ApplicationWithProfile[] || []).map((app) => ({
          id: app.id,
          opportunity_id: app.opportunity_id,
          applicant_id: app.applicant_id,
          cover_letter: app.cover_letter,
          status: app.status as OpportunityApplicationWithApplicant['status'],
          applied_at: app.applied_at,
          updated_at: app.updated_at,
          metadata: app.metadata as Json,
          applicant: {
            id: app.applicant.id,
            full_name: app.applicant.full_name,
            avatar_url: app.applicant.avatar_url,
            position: app.applicant.position,
            secondary_position: app.applicant.secondary_position,
            base_location: app.applicant.base_location,
            nationality: app.applicant.nationality,
            username: app.applicant.username,
          },
        }))

        // Fetch reference data for all applicants (non-blocking on failure)
        const refMap = new Map<string, ApplicantReferenceInfo>()
        try {
          const ids = transformedApplications.map((app) => app.applicant.id)
          if (ids.length > 0) {
            const { data: referencesData } = await supabase
              .from('profile_references')
              .select(`
                requester_id,
                endorsement_text,
                relationship_type,
                accepted_at,
                reference:profiles!profile_references_reference_id_fkey (
                  id,
                  full_name,
                  role,
                  username
                )
              `)
              .in('requester_id', ids)
              .eq('status', 'accepted')
              .order('accepted_at', { ascending: false })

            if (referencesData) {
              for (const ref of referencesData) {
                const endorser = ref.reference as { id: string; full_name: string | null; role: string | null; username: string | null } | null
                const existing = refMap.get(ref.requester_id)
                if (!existing) {
                  refMap.set(ref.requester_id, {
                    count: 1,
                    topEndorsement: ref.endorsement_text ? {
                      text: ref.endorsement_text,
                      endorserName: endorser?.full_name ?? 'PLAYR Member',
                      endorserRole: endorser?.role ?? null,
                      relationshipType: ref.relationship_type,
                    } : null,
                  })
                } else {
                  existing.count += 1
                  if (!existing.topEndorsement && ref.endorsement_text) {
                    existing.topEndorsement = {
                      text: ref.endorsement_text,
                      endorserName: endorser?.full_name ?? 'PLAYR Member',
                      endorserRole: endorser?.role ?? null,
                      relationshipType: ref.relationship_type,
                    }
                  }
                }
              }
            }
          }
        } catch (refErr) {
          logger.error('Failed to fetch reference data for applicants:', refErr)
          setReferencesUnavailable(true)
        }

        setReferenceMap(refMap)
        setApplications(transformedApplications)
      } catch {
        setError('Failed to load applicants. Please try again.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [opportunityId, user])

  const handleStatusChange = useCallback(async (applicationId: string, newStatus: ApplicationStatus) => {
    setUpdatingId(applicationId)

    // Optimistic update
    setApplications((prev) =>
      prev.map((app) => (app.id === applicationId ? { ...app, status: newStatus } : app))
    )

    try {
      const { error: updateError } = await supabase
        .from('opportunity_applications')
        .update({ status: newStatus })
        .eq('id', applicationId)

      if (updateError) throw updateError
    } catch (err) {
      // Revert optimistic update
      setApplications((prev) =>
        prev.map((app) => {
          if (app.id !== applicationId) return app
          // We don't know the old status, so refetch
          return app
        })
      )
      logger.error('Error updating application status:', err)
      addToast('Failed to update status. Please try again.', 'error')

      // Refetch to ensure consistency
      if (opportunityId) {
        const { data } = await supabase
          .from('opportunity_applications')
          .select(`
            *,
            applicant:applicant_id (
              id, full_name, avatar_url, position, secondary_position,
              base_location, nationality, username
            )
          `)
          .eq('opportunity_id', opportunityId)
          .order('applied_at', { ascending: false })

        if (data) {
          setApplications(data as unknown as OpportunityApplicationWithApplicant[])
        }
      }
    } finally {
      setUpdatingId(null)
    }
  }, [addToast, opportunityId])

  // Group applications by tier
  const groupedApplications = useMemo(() => {
    return TIER_GROUPS.map((group) => ({
      ...group,
      applications: applications.filter((app) => group.statuses.includes(app.status)),
    })).filter((group) => group.applications.length > 0)
  }, [applications])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#8026FA] mb-4"></div>
          <p className="text-gray-600">Loading applicants...</p>
        </div>
      </div>
    )
  }

  if (error || !opportunity) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error || 'Opportunity not found.'}</p>
          <button
            type="button"
            onClick={() => navigate('/dashboard/profile')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Opportunities
          </button>

          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Applicants for {opportunity.title}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <Users className="h-4 w-4" />
              {applications.length} applicant{applications.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        {referencesUnavailable && applications.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Reference data could not be loaded. Applicant references may not be shown.
          </div>
        )}
        {applications.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
            <div className="mb-4 text-5xl">📭</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 sm:text-xl">No Applicants Yet</h3>
            <p className="text-sm text-gray-600 sm:text-base">
              Applications will appear here once players start applying to this opportunity.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedApplications.map((group) => {
              const Icon = group.icon
              return (
                <section key={group.key}>
                  <div className="mb-3 flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${group.iconClass}`} />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {group.label}
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {group.applications.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {group.applications.map((application) => (
                      <ApplicantCard
                        key={application.id}
                        application={application}
                        onStatusChange={handleStatusChange}
                        isUpdating={updatingId === application.id}
                        referenceInfo={referenceMap.get(application.applicant_id) ?? null}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
