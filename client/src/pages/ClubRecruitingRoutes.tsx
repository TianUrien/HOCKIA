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
const ClubEditScreen = lazy(() => import('@/components/club/ClubEditScreen'))
const HockiaSuggestsScreen = lazy(() => import('@/components/club/HockiaSuggestsScreen'))
const SuggestRefineScreen = lazy(() => import('@/components/club/SuggestRefineScreen'))

const OpportunitiesPage = lazy(() => import('@/pages/OpportunitiesPage'))
const ApplicantsList = lazy(() => import('@/pages/ApplicantsList'))

/**
 * Phone routing for the club's recruiting screens (Figma 04 Club · Row 1).
 * Phones: a club's Opportunities tab is its own roles; a role's applicants
 * and each applicant review are the v2 screens, for clubs and for coaches who
 * recruit (their roles live under Opportunities · My roles). Desktop and every
 * other role keep the existing pages.
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

// The v2 applicant screens are for whoever publishes roles: clubs, and coaches
// who recruit for their team (isRecruitingViewer; the server answers only the
// role's publisher). Everyone else (players, coaches who only look for a role)
// keeps ApplicantsList, which refuses non-owners. Profile still loading →
// blank, so a recruiter never flashes the v1 page.
export function ApplicantsEntry() {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (isPhone && opportunityId) {
    if (!profile?.role) return <Blank />
    if (isRecruitingViewer(profile)) return <Screen><ApplicantsScreen roleId={opportunityId} /></Screen>
  }
  return <Screen><ApplicantsList /></Screen>
}

export function ApplicantReviewEntry() {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  const { opportunityId, applicationId } = useParams<{ opportunityId: string; applicationId: string }>()
  if (!opportunityId || !applicationId) return <Navigate to="/opportunities" replace />
  if (!isPhone || (profile?.role && !isRecruitingViewer(profile))) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  if (!profile?.role) return <Blank />
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

/** D5 · Hockia suggests (Figma D5.1 398:83) and its refine chat (D5.2 398:291):
 *  phones, for the role's publisher (a club or a coach who recruits). The
 *  server answers only the publisher; everyone else is sent back to the role
 *  (desktop) or Home (not a recruiter). Players never reach it. */
export function HockiaSuggestsEntry({ refine = false }: { refine?: boolean }) {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (!opportunityId) return <Navigate to="/opportunities" replace />
  if (!profile) return <Blank />
  if (!isRecruitingViewer(profile)) return <Navigate to="/home" replace />
  if (!isPhone) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  return <Screen>{refine ? <SuggestRefineScreen key={opportunityId} roleId={opportunityId} /> : <HockiaSuggestsScreen key={opportunityId} roleId={opportunityId} />}</Screen>
}

/** Edit club profile (Figma 04 Club D1.27): phone clubs only. Desktop clubs
 *  (and anyone else) keep the v1 editor, opened by ?action=edit. */
export function ClubEditEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  if (!role) return <Blank />
  if (!isPhone || role !== 'club') return <Navigate to="/dashboard/profile?action=edit" replace />
  return <Screen><ClubEditScreen /></Screen>
}
