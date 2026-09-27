import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/lib/auth'
import { isRecruitingViewer } from '@/lib/recruiterAccess'

// Every screen is its own chunk: players on /opportunities and desktop
// clubs never download the club phone screens.
const ClubOpportunitiesScreen = lazy(() => import('@/components/club/ClubOpportunitiesScreen'))
const ApplicantsScreen = lazy(() => import('@/components/club/ApplicantsScreen'))
const ApplicantReviewScreen = lazy(() => import('@/components/club/ApplicantReviewScreen'))
const PostRoleScreen = lazy(() => import('@/components/club/PostRoleScreen'))
const RolePostedScreen = lazy(() => import('@/components/club/RolePostedScreen'))
const FindPlayersScreen = lazy(() => import('@/components/club/FindPlayersScreen'))
const ShortlistScreen = lazy(() => import('@/components/club/ShortlistScreen'))

const OpportunitiesPage = lazy(() => import('@/pages/OpportunitiesPage'))
const ApplicantsList = lazy(() => import('@/pages/ApplicantsList'))

/**
 * Phone routing for the club's recruiting screens (Figma 04 Club · Row 1).
 * Phones: a club's Opportunities tab is its own roles; a role's applicants
 * and each applicant review are the v2 screens. Desktop and every other
 * role keep the existing pages.
 */
const PHONE = '(max-width: 1023px)'

const Blank = () => <div className="min-h-screen bg-white" />

const Screen = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<Blank />}>{children}</Suspense>
)

export function OpportunitiesEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  if (isPhone && role === 'club') return <Screen><ClubOpportunitiesScreen /></Screen>
  return <Screen><OpportunitiesPage /></Screen>
}

// The v2 applicant screens are for clubs only, like the Opportunities tab above.
// Everyone else (players, and coaches until Coach v2 opens these to recruiting
// coaches) keeps ApplicantsList, which refuses non-owners. Role still loading →
// blank, so a club never flashes the v1 page.
export function ApplicantsEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (isPhone && opportunityId) {
    if (!role) return <Blank />
    if (role === 'club') return <Screen><ApplicantsScreen roleId={opportunityId} /></Screen>
  }
  return <Screen><ApplicantsList /></Screen>
}

export function ApplicantReviewEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  const { opportunityId, applicationId } = useParams<{ opportunityId: string; applicationId: string }>()
  if (!opportunityId || !applicationId) return <Navigate to="/opportunities" replace />
  if (!isPhone || (role && role !== 'club')) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  if (!role) return <Blank />
  return <Screen><ApplicantReviewScreen roleId={opportunityId} applicationId={applicationId} /></Screen>
}

/** Post a role (Figma 04 Club 330:318): phone clubs only. Desktop keeps the
 *  create modal on Opportunities; `/:id/edit` continues a draft. */
export function PostRoleEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  const { opportunityId } = useParams<{ opportunityId?: string }>()
  if (!isPhone || (role && role !== 'club')) return <Navigate to="/opportunities" replace />
  return <Screen><PostRoleScreen key={opportunityId ?? 'new'} draftId={opportunityId ?? null} /></Screen>
}

/** Role posted (Figma 04 Club D1.26): phone clubs only; the screen loads the
 *  role itself, so a refresh shows the same screen. Desktop → Opportunities. */
export function RolePostedEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (!opportunityId) return <Navigate to="/opportunities" replace />
  if (!isPhone || (role && role !== 'club')) return <Navigate to="/opportunities" replace state={{ highlight: opportunityId }} />
  if (!role) return <Blank />
  return <Screen><RolePostedScreen key={opportunityId} roleId={opportunityId} /></Screen>
}

/** Find players (Figma 04 Club D1.9) and the per-role Shortlist (D1.10):
 *  phones, for clubs and coaches who recruit. Desktop keeps Community and the
 *  v1 shortlists; everyone else goes to Community / Home. Query params
 *  (?role=, ?context=none) pass through to Find players. */
export function FindPlayersEntry() {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  if (!profile) return <Blank />
  if (!isPhone || !isRecruitingViewer(profile)) return <Navigate to="/community/players" replace />
  return <Screen><FindPlayersScreen /></Screen>
}

export function ShortlistEntry() {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  if (!profile) return <Blank />
  if (!isRecruitingViewer(profile)) return <Navigate to="/home" replace />
  if (!isPhone) return <Navigate to="/dashboard/shortlists" replace />
  return <Screen><ShortlistScreen /></Screen>
}
