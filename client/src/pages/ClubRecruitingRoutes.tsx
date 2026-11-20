import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/lib/auth'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { countryRolesDescription, countryRolesPath, countryRolesTitle, resolveRoleCountry } from '@/lib/seo/opportunitiesCountry'

// Every screen is its own chunk: players on /opportunities and desktop
// clubs never download the club phone screens.
const ClubOpportunitiesScreen = lazy(() => import('@/components/club/ClubOpportunitiesScreen'))
const ApplicantsScreen = lazy(() => import('@/components/club/ApplicantsScreen'))
const ApplicantsDesktop = lazy(() => import('@/components/club/ApplicantsDesktop'))
const ApplicantReviewScreen = lazy(() => import('@/components/club/ApplicantReviewScreen'))
const PostRoleScreen = lazy(() => import('@/components/club/PostRoleScreen'))
const RecruitConfirmScreen = lazy(() => import('@/components/club/RecruitConfirmScreen'))
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

function setMetaContent(selector: string, content: string) {
  document.querySelector(selector)?.setAttribute('content', content)
}

/**
 * /opportunities/in/:slug: the open roles of one country. The server sends
 * this URL with the country's own head and the roles as text
 * (api/opportunities-country.ts); here the app shows the same list as
 * /opportunities with the country filter already set. The filter lives in
 * the query string the list reads when it mounts, so it is written first.
 * A slug that is not a country goes to the full list.
 */
export function OpportunitiesCountryEntry() {
  const { slug } = useParams<{ slug: string }>()
  const country = resolveRoleCountry(slug)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const hasFilter = Boolean(searchParams.get('country'))

  // The list mounts once the filter is in the URL. After that, clearing the
  // filter is the visitor's choice and is not written back.
  useEffect(() => {
    if (!country) return
    if (hasFilter) {
      setReady(true)
    } else if (!ready) {
      const next = new URLSearchParams(searchParams)
      next.set('country', country.name)
      navigate({ pathname: countryRolesPath(country), search: `?${next.toString()}` }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country?.code, hasFilter])

  // After the list has mounted (its own effect writes the /opportunities
  // head), so the country's title and description are the ones that stay.
  useEffect(() => {
    if (!country || !ready) return
    const title = countryRolesTitle(country)
    const description = countryRolesDescription(country)
    document.title = title
    setMetaContent('meta[name="description"]', description)
    setMetaContent('meta[property="og:title"]', title)
    setMetaContent('meta[property="og:description"]', description)
    setMetaContent('meta[property="og:url"]', `https://inhockia.com${countryRolesPath(country)}`)
  }, [country, ready])

  if (!country) return <Navigate to="/opportunities" replace />
  if (!ready && !hasFilter) return <Blank />
  return <OpportunitiesEntry />
}

/**
 * /opportunities/:word where the word is a country name (/opportunities/
 * australia): the country's page. Anything else renders `fallback`, the
 * role page, which shows its own not-found state.
 */
export function CountryWordRedirect({ word, fallback }: { word: string; fallback: ReactNode }) {
  const country = word.length > 2 ? resolveRoleCountry(word) : null
  return country ? <Navigate to={countryRolesPath(country)} replace /> : <>{fallback}</>
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
  if (opportunityId) {
    if (!profile?.role) return <Blank />
    // Desktop D4 master-detail replaces the v1 list for recruiters (ruling 16 Oct 2026).
    if (isRecruitingViewer(profile)) return <Screen>{isPhone ? <ApplicantsScreen roleId={opportunityId} /> : <ApplicantsDesktop roleId={opportunityId} />}</Screen>
  }
  return <Screen><ApplicantsList /></Screen>
}

export function ApplicantReviewEntry() {
  const isPhone = useMediaQuery(PHONE)
  const profile = useAuthStore((s) => s.profile)
  const { opportunityId, applicationId } = useParams<{ opportunityId: string; applicationId: string }>()
  if (!opportunityId || !applicationId) return <Navigate to="/opportunities" replace />
  if (profile?.role && !isRecruitingViewer(profile)) return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants`} replace />
  // Desktop: the master-detail page opens on this application.
  if (!isPhone) {
    // Keep the rest of the query (e.g. the Last call email's ?decline=1, which the pane reads).
    const q = new URLSearchParams(window.location.search)
    q.set('a', applicationId)
    return <Navigate to={`/dashboard/opportunities/${opportunityId}/applicants?${q.toString()}`} replace />
  }
  if (!profile?.role) return <Blank />
  return <Screen><ApplicantReviewScreen key={applicationId} roleId={opportunityId} applicationId={applicationId} /></Screen>
}

/** Post a role (Figma 04 Club 330:318; desktop: rebrand page 27): clubs and
 *  coaches (who recruit on behalf of a club or academy), on every width.
 *  `/:id/edit` continues a draft or edits a live role. */
export function PostRoleEntry() {
  const profile = useAuthStore((s) => s.profile)
  const role = profile?.role
  const { opportunityId } = useParams<{ opportunityId?: string }>()
  if (role && role !== 'club' && role !== 'coach') return <Navigate to="/opportunities" replace />
  // A coach who only looks for a role confirms they recruit before posting (iOS audit 2026-11-06).
  if (role === 'coach' && !opportunityId && !isRecruitingViewer(profile)) return <Screen><RecruitConfirmScreen /></Screen>
  return <Screen><PostRoleScreen key={opportunityId ?? 'new'} draftId={opportunityId ?? null} /></Screen>
}

/** Role posted (Figma 04 Club D1.26): phone clubs and coaches; the screen
 *  loads the role itself, so a refresh shows the same screen. Desktop →
 *  Opportunities (a coach's: My opportunities). */
export function RolePostedEntry() {
  const isPhone = useMediaQuery(PHONE)
  const role = useAuthStore((s) => s.profile?.role)
  const { opportunityId } = useParams<{ opportunityId: string }>()
  if (!opportunityId) return <Navigate to="/opportunities" replace />
  if (role && role !== 'club' && role !== 'coach') return <Navigate to="/opportunities" replace />
  if (!isPhone) return <Navigate to={role === 'coach' ? '/opportunities?view=mine' : '/opportunities'} replace state={{ highlight: opportunityId }} />
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
