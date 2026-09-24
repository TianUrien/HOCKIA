import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/lib/auth'

// Every screen is its own chunk: players on /opportunities and desktop
// clubs never download the club phone screens.
const ClubOpportunitiesScreen = lazy(() => import('@/components/club/ClubOpportunitiesScreen'))
const ApplicantsScreen = lazy(() => import('@/components/club/ApplicantsScreen'))
const ApplicantReviewScreen = lazy(() => import('@/components/club/ApplicantReviewScreen'))

const OpportunitiesPage = lazy(() => import('@/pages/OpportunitiesPage'))
const ApplicantsList = lazy(() => import('@/pages/ApplicantsList'))

/**
 * Phone routing for the club's recruiting screens (Figma 04 Club · Row 1).
 * Phones: a club's Opportunities tab is its own roles; a role's applicants
 * and each applicant review are the v2 screens. Desktop and every other
 * role keep the existing pages.
 */
const PHONE = '(max-width: 1023px)'

const Screen = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="min-h-screen bg-white" />}>{children}</Suspense>
)

export function OpportunitiesEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  if (isPhone && role === 'club') return <Screen><ClubOpportunitiesScreen /></Screen>
  return <Screen><OpportunitiesPage /></Screen>
}

export function ApplicantsEntry() {
  const isPhone = useMediaQuery(PHONE)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (isPhone && opportunityId) return <Screen><ApplicantsScreen roleId={opportunityId} /></Screen>
  return <Screen><ApplicantsList /></Screen>
}

export function ApplicantReviewEntry() {
  const isPhone = useMediaQuery(PHONE)
  const { opportunityId, applicationId } = useParams<{ opportunityId: string; applicationId: string }>()
  if (!opportunityId || !applicationId) return <Navigate to="/opportunities" replace />
  if (!isPhone) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  return <Screen><ApplicantReviewScreen roleId={opportunityId} applicationId={applicationId} /></Screen>
}
