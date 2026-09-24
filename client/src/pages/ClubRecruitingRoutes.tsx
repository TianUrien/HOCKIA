import { lazy } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/lib/auth'
import ClubOpportunitiesScreen from '@/components/club/ClubOpportunitiesScreen'
import ApplicantsScreen from '@/components/club/ApplicantsScreen'
import ApplicantReviewScreen from '@/components/club/ApplicantReviewScreen'

const OpportunitiesPage = lazy(() => import('@/pages/OpportunitiesPage'))
const ApplicantsList = lazy(() => import('@/pages/ApplicantsList'))

/**
 * Phone routing for the club's recruiting screens (Figma 04 Club · Row 1).
 * Phones: a club's Opportunities tab is its own roles; a role's applicants
 * and each applicant review are the v2 screens. Desktop and every other
 * role keep the existing pages.
 */
const PHONE = '(max-width: 1023px)'

export function OpportunitiesEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  if (isPhone && role === 'club') return <ClubOpportunitiesScreen />
  return <OpportunitiesPage />
}

export function ApplicantsEntry() {
  const isPhone = useMediaQuery(PHONE)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (isPhone && opportunityId) return <ApplicantsScreen roleId={opportunityId} />
  return <ApplicantsList />
}

export function ApplicantReviewEntry() {
  const isPhone = useMediaQuery(PHONE)
  const { opportunityId, applicationId } = useParams<{ opportunityId: string; applicationId: string }>()
  if (!opportunityId || !applicationId) return <Navigate to="/opportunities" replace />
  if (!isPhone) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  return <ApplicantReviewScreen roleId={opportunityId} applicationId={applicationId} />
}
