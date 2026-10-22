import { useEffect, useState, useCallback, useMemo } from 'react'
import { NETWORK_ERROR_COPY } from '@/lib/networkCopy'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import { logger } from '../lib/logger'
import { trackDbEvent } from '../lib/trackDbEvent'
import { readNavSource } from '../lib/navSource'
import { trackVacancyView } from '../lib/analytics'
import type { Opportunity } from '../lib/supabase'
import Header from '../components/Header'
import ApplyToOpportunityModal from '../components/ApplyToOpportunityModal'
import SignInPromptModal from '../components/SignInPromptModal'
import OpportunityJsonLd from '../components/OpportunityJsonLd'
import { OpportunityDetailMobile } from '../components/opportunities/OpportunityDetailMobile'
import { OpportunityDetailDesktop } from '../components/opportunities/OpportunityDetailDesktop'
import { roleIdentity } from '@/lib/opportunityIdentity'
import { useClubCrestPalettes, useWorldClubCrestPalettes } from '@/hooks/useClubCrestColors'
import OwnApplicationRoad from '../components/opportunities/OwnApplicationRoad'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { loadRoleDetail } from '@/lib/roleDetail'
import { isNetworkFailureError } from '@/lib/sentryHelpers'
import { RoleDetailSkeleton } from '@/components/ScreenSkeletons'

/** The app's failed-load words (sign-in, Community): the connection, not the member. */

/** PostgREST "no row" for `.single()`: the role is gone or not visible to this viewer. */
function isRowNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (isNetworkFailureError(error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'PGRST116'
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const routerLocation = useLocation()
  // Where the member came from (Home card, Opportunities, push, inbox…): tags vacancy_view and application_submit.
  const navSource = readNavSource(location)
  const { user, profile } = useAuthStore()

  // X-close behavior: if the user arrived via in-app navigation (from the
  // list, home feed, search, notification, etc.), pop back so
  // useScrollRestore returns them to the previous page's scrollY.
  // location.key === 'default' only on the session's first navigation,
  // which means we got here via deep link / shared URL / email CTA —
  // there's no useful history to pop, so fall back to the list.
  const handleClose = useCallback(() => {
    if (routerLocation.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/opportunities')
    }
  }, [routerLocation.key, navigate])
  const isCurrentUserTestAccount = profile?.is_test_account ?? false
  // Primitives for the fetch below: the auth store re-sets `user` / `profile`
  // as NEW objects a few seconds after load (profile refresh, token refresh),
  // which used to re-run the whole fetch and rebuild the page under the
  // first tap on the role's controls (QA round 7 re-check: "Withdraw
  // application" ignored the first tap ~5 s after load). Same id and role →
  // nothing to refetch.
  const userId = user?.id ?? null
  const viewerRole = profile?.role ?? null
  // On staging the opportunities list shows test-account postings to
  // everyone (OpportunitiesPage skips the test filter when isStaging).
  // The detail route must match — otherwise a listed opportunity 404s
  // the moment a non-test user clicks through to it.
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
  
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [club, setClub] = useState<{ id: string; full_name: string | null; avatar_url: string | null; role: string | null; current_club: string | null; coach_current_role?: string | null; womens_league_division: string | null; mens_league_division: string | null } | null>(null)
  const [worldClub, setWorldClub] = useState<{ id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null } | null>(null)
  const [hasApplied, setHasApplied] = useState(false)
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  // One Join sheet for every gated trigger, the trigger named in the title.
  const [wallTitle, setWallTitle] = useState('Sign in to apply')
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  /** The read failed (connection or server), not a missing role: offer Retry. */
  const [loadFailed, setLoadFailed] = useState(false)
  const [isClosed, setIsClosed] = useState(false)

  // Title resolves to the opportunity name once loaded; stays neutral
  // ("Opportunity") while fetching so the tab doesn't flash the static
  // "HOCKIA – Where field hockey sticks together." suffix during the load.
  useDocumentTitle(opportunity?.title ? `${opportunity.title} • Opportunities` : 'Opportunity')
  // Phone and desktop get different trees. The desktop OpportunityDetailView
  // is a dialog that pins the document (useBodyScrollLock) because it scrolls
  // inside its own fixed layer; the phone layout scrolls the document. Hiding
  // the desktop tree with CSS still MOUNTS it, so its lock froze the phone
  // page (iPhone, 15 Oct 2026). Mount one tree or the other, never both.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Cover palette for the hero: the directory club's crest when the role is linked to one, else the publisher's.
  const profilePalettes = useClubCrestPalettes(useMemo(() => (club && club.role !== 'coach' ? [{ id: club.id, avatar_url: club.avatar_url }] : []), [club]))
  const worldPalettes = useWorldClubCrestPalettes(useMemo(() => (worldClub ? [{ id: worldClub.id, avatar_url: worldClub.avatarUrl }] : []), [worldClub]))
  const coverPalette = (worldClub && worldPalettes.get(worldClub.id)) || (club ? profilePalettes.get(club.id) : null) || null

  const fetchVacancyDetails = useCallback(async () => {
    if (!id) return

    try {
      // Guard malformed IDs. opportunities.id is a uuid — querying it with a
      // non-uuid (e.g. /opportunities/12345) makes PostgREST throw an
      // "invalid input syntax for uuid" error; catch it here and render the
      // friendly not-found screen instead of letting the route crash.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!UUID_RE.test(id)) {
        logger.debug('Opportunity id is not a valid uuid:', id)
        setNotFound(true)
        return
      }

      // Fetch opportunity with club details including is_test_account. A role
      // card may have warmed this read already (lib/prefetchRole); same query.
      const { data: rawOpportunity, error: opportunityError } = await loadRoleDetail(id)
      const opportunityData = rawOpportunity as Opportunity | null

      // A read that never reached HOCKIA (offline, dropped cellular) or a
      // server failure is not "removed": show the retry state instead.
      if (opportunityError && !isRowNotFound(opportunityError)) {
        logger.error('Opportunity read failed:', opportunityError)
        setLoadFailed(true)
        return
      }
      if (!opportunityData) {
        logger.error('Opportunity not found:', opportunityError)
        setNotFound(true)
        return
      }

      // Status is the single source of truth for closed/open — matching the
      // Opportunities list + in-app OpportunityDetailView. An opportunity is
      // closed ONLY when its creator changes the status; a passed
      // application_deadline does NOT auto-close it (the club/coach may still be
      // accepting). This stops the Home-feed "Apply Now" from dead-ending on a
      // still-open opportunity whose deadline merely lapsed. A passed deadline
      // is surfaced as informational text, not a block.
      setIsClosed(opportunityData.status !== 'open')

      // Check if this is a test opportunity and current user is not a test account
      type WorldClubJoin = {
        id: string
        club_name: string
        avatar_url: string | null
        country: { name: string; flag_emoji: string | null } | null
        men_league: { name: string; tier: number | null } | null
        women_league: { name: string; tier: number | null } | null
      } | null
      const opportunityWithClub = opportunityData as Opportunity & {
        club?: { id: string; full_name: string | null; avatar_url: string | null; is_test_account?: boolean; role?: string | null; current_club?: string | null; coach_current_role?: string | null; womens_league_division?: string | null; mens_league_division?: string | null }
        world_club?: WorldClubJoin
      }
      if (opportunityWithClub.club?.is_test_account && !isCurrentUserTestAccount && !isStaging) {
        // Real users cannot view test opportunities — but on staging the
        // list shows them, so the detail route allows them there too.
        logger.debug('Test opportunity not accessible to non-test user')
        setNotFound(true)
        return
      }

      setOpportunity(opportunityData as Opportunity)

      // Set club from the joined data
      if (opportunityWithClub.club) {
        setClub({
          id: opportunityWithClub.club.id,
          full_name: opportunityWithClub.club.full_name,
          avatar_url: opportunityWithClub.club.avatar_url,
          role: opportunityWithClub.club.role ?? null,
          current_club: opportunityWithClub.club.current_club ?? null,
          coach_current_role: opportunityWithClub.club.coach_current_role ?? null,
          womens_league_division: opportunityWithClub.club.womens_league_division ?? null,
          mens_league_division: opportunityWithClub.club.mens_league_division ?? null,
        })
      }

      // Set world club from the joined data
      if (opportunityWithClub.world_club) {
        const wc = opportunityWithClub.world_club
        setWorldClub({
          id: wc.id,
          clubName: wc.club_name,
          avatarUrl: wc.avatar_url,
          countryName: wc.country?.name ?? null,
          flagEmoji: wc.country?.flag_emoji ?? null,
          leagueName: wc.men_league?.name ?? wc.women_league?.name ?? null,
        })
      } else {
        setWorldClub(null)
      }

      // Check if user has applied
      if (userId && (viewerRole === 'player' || viewerRole === 'coach')) {
        const { data: applicationData, error: applicationError } = await supabase
          .from('opportunity_applications')
          .select('id, status')
          .eq('opportunity_id', id)
          .eq('applicant_id', userId)
          .maybeSingle()

        // A failed read keeps what the page already knows (see refreshApplicationStatus).
        if (!applicationError) {
          setHasApplied(!!applicationData)
          setApplicationStatus((applicationData as { status?: string } | null)?.status ?? null)
          setApplicationId((applicationData as { id?: string } | null)?.id ?? null)
        }
      }
    } catch (error) {
      logger.error('Error fetching opportunity details:', error)
      if (isNetworkFailureError(error)) setLoadFailed(true)
      else setNotFound(true)
    } finally {
      setIsLoading(false)
    }
  }, [id, userId, viewerRole, isCurrentUserTestAccount, isStaging])

  const retryLoad = useCallback(() => {
    setLoadFailed(false)
    setNotFound(false)
    setIsLoading(true)
    void fetchVacancyDetails()
  }, [fetchVacancyDetails])

  useEffect(() => {
    if (!id) {
      navigate('/opportunities')
      return
    }

    fetchVacancyDetails()
  }, [id, navigate, fetchVacancyDetails])

  // NOTE: viewing this page no longer auto-mutates the owner's global
  // recruiting context (removed alongside the matching ApplicantsList
  // auto-scope). Silently activating a context here changed Fit chips +
  // the Community carousel everywhere the moment an owner opened their
  // own opportunity — an unrequested side effect. Owners who want to
  // scope Community to an opportunity do it explicitly via the "Your
  // opportunities" picker in the ContextSwitcher sheet.

  // SEO: Update page title and meta tags for crawlers
  useEffect(() => {
    if (!opportunity || !club) {
      document.title = 'Field Hockey Opportunity | HOCKIA'
      return
    }

    // Dynamic page title
    const pageTitle = `${opportunity.title} at ${club.full_name || 'Club'} | HOCKIA`
    document.title = pageTitle

    // Build meta description
    const location = [opportunity.location_city, opportunity.location_country].filter(Boolean).join(', ')
    const metaDescription = `${opportunity.title} opportunity at ${club.full_name || 'a club'}${location ? ` in ${location}` : ''}. ${opportunity.description?.slice(0, 120) || 'Apply now on HOCKIA - the field hockey community platform.'}`

    // Update or create meta description
    const metaDescTag = document.querySelector('meta[name="description"]')
    if (metaDescTag) {
      metaDescTag.setAttribute('content', metaDescription)
    }

    // Update Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) ogTitle.setAttribute('content', pageTitle)

    const ogDesc = document.querySelector('meta[property="og:description"]')
    if (ogDesc) ogDesc.setAttribute('content', metaDescription)

    const ogUrl = document.querySelector('meta[property="og:url"]')
    if (ogUrl) ogUrl.setAttribute('content', `https://inhockia.com/opportunities/${opportunity.id}`)

    // Update Twitter tags
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')
    if (twitterTitle) twitterTitle.setAttribute('content', pageTitle)

    const twitterDesc = document.querySelector('meta[name="twitter:description"]')
    if (twitterDesc) twitterDesc.setAttribute('content', metaDescription)

    // Cleanup: restore defaults when leaving page
    return () => {
      document.title = 'HOCKIA | Field Hockey Community'
      const defaultDesc = 'Connect players, coaches, and clubs. Raise the sport together. Join HOCKIA.'

      if (metaDescTag) metaDescTag.setAttribute('content', defaultDesc)
      if (ogTitle) ogTitle.setAttribute('content', 'HOCKIA | Field Hockey Community')
      if (ogDesc) ogDesc.setAttribute('content', defaultDesc)
      if (ogUrl) ogUrl.setAttribute('content', 'https://inhockia.com')
      if (twitterTitle) twitterTitle.setAttribute('content', 'HOCKIA | Field Hockey Community')
      if (twitterDesc) twitterDesc.setAttribute('content', defaultDesc)
    }
  }, [opportunity, club])

  // Track vacancy view
  useEffect(() => {
    if (!opportunity) return
    trackDbEvent('vacancy_view', 'vacancy', opportunity.id, {
      position: opportunity.position ?? undefined,
      location: opportunity.location_city ?? undefined,
      source: navSource,
    })
    void trackVacancyView(opportunity.id, opportunity.position ?? undefined, opportunity.location_city ?? undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.id])

  const refreshApplicationStatus = async () => {
    // Allow both players and coaches to refresh their application status
    if (!id || !user || !['player', 'coach'].includes(profile?.role ?? '')) return

    const { data, error } = await supabase
      .from('opportunity_applications')
      .select('id, status')
      .eq('opportunity_id', id)
      .eq('applicant_id', user.id)
      .maybeSingle()

    // A failed read keeps what the page already knows: clearing the
    // application here would unmount the applicant's road under a tap.
    if (error) return
    setHasApplied(!!data)
    setApplicationStatus((data as { status?: string } | null)?.status ?? null)
    setApplicationId((data as { id?: string } | null)?.id ?? null)
  }

  if (isLoading) {
    return (
      <>
        <Header mobileHidden />
        <RoleDetailSkeleton />
      </>
    )
  }

  if (loadFailed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center px-4" style={{ height: 'calc(100vh - 80px)', paddingTop: '80px' }}>
          <div className="max-w-sm text-center" role="alert" data-testid="role-load-failed">
            <h1 className="text-[20px] font-semibold leading-6 text-ink-1">Couldn’t load this role</h1>
            <p className="mt-2 text-row text-ink-2">{NETWORK_ERROR_COPY}</p>
            <button
              type="button"
              onClick={retryLoad}
              className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-brand-primary px-6 text-[16px] font-semibold text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !opportunity || !club) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 80px)', paddingTop: '80px' }}>
          <div className="text-center">
            <h1 className="mb-2 text-[20px] font-semibold leading-6 text-ink-1">Role not found</h1>
            <p className="mb-6 text-row text-ink-2">This role may have been removed.</p>
            <button
              type="button"
              onClick={() => navigate('/opportunities')}
              className="inline-flex h-12 items-center justify-center rounded-full bg-brand-primary px-6 text-[16px] font-semibold text-white hover:opacity-90"
            >
              Browse opportunities
            </button>
          </div>
        </div>
      </div>
    )
  }

  // A closed role is no longer a dead-end page: it renders below in its
  // closed state (greyed, "Closed", no Apply) with the viewer's own
  // application if they applied — see OpportunityDetailMobile.

  // Determine what happens when user clicks "Apply"
  const handleApplyClick = () => {
    if (!user) {
      // Not authenticated - show the Join sheet
      setWallTitle('Sign in to apply')
      setShowSignInPrompt(true)
    } else if (
      ((profile?.role === 'player' && opportunity.opportunity_type === 'player') ||
       (profile?.role === 'coach' && opportunity.opportunity_type === 'coach')) &&
      !hasApplied
    ) {
      // Authenticated player/coach whose role matches the opportunity type - show apply modal
      setShowApplyModal(true)
    }
    // Clubs, role mismatches, or users who have already applied - button shouldn't be shown
  }

  // Message the club — guests land on the same Join sheet. `anchor: 'offer'`
  // (D4 "See the offer") opens the thread scrolled to THIS application's
  // newest offer card (not another role's); used straight as an onClick too,
  // so anything else (an event) is ignored.
  const handleMessageClick = (anchor?: unknown) => {
    if (!user) {
      setWallTitle('Sign in to message')
      setShowSignInPrompt(true)
      return
    }
    const seeOffer = anchor === 'offer'
    navigate(`/messages?new=${club.id}`, {
      state: { from: location.pathname, anchor: seeOffer ? 'offer' : undefined, anchorApplicationId: seeOffer ? applicationId ?? null : undefined },
    })
  }
  const leagueForPhone = (() => {
    if (worldClub?.leagueName) return worldClub.leagueName
    const womensFamily = opportunity.gender === 'Women' || opportunity.gender === 'Girls'
    return (womensFamily
      ? club.womens_league_division ?? club.mens_league_division
      : club.mens_league_division ?? club.womens_league_division) ?? null
  })()
  const identity = roleIdentity({ publisherRole: club.role, publisherName: club.full_name, publisherAvatar: club.avatar_url, organizationName: opportunity.organization_name, publisherCurrentClub: club.current_club, publisherCoachRole: club.coach_current_role, worldClub: worldClub ? { name: worldClub.clubName, avatarUrl: worldClub.avatarUrl } : null })

  // Determine if user can apply (or should see the apply button)
  const canShowApplyButton = !isClosed && !hasApplied && (
    !user || // Not logged in - show button to trigger sign-in prompt
    (profile?.role === 'player' && opportunity.opportunity_type === 'player') ||
    (profile?.role === 'coach' && opportunity.opportunity_type === 'coach')
  )

  return (
    <>
      {/* Structured data for AI discoverability — open roles only: a closed
          role must not be advertised as a live job posting. */}
      {!isClosed && (
        <OpportunityJsonLd
          vacancy={opportunity}
          club={{
            name: club.full_name || 'Unknown Club',
            logoUrl: club.avatar_url,
          }}
        />
      )}
      
      <div className="min-h-screen bg-white lg:bg-gray-50">
        <Header mobileHidden />
        {/* Phone: Figma Opportunity detail v2 / — applied */}
        {!isDesktop && (
        <div className="lg:hidden">
          <OpportunityDetailMobile
            vacancy={opportunity}
            clubName={identity.displayName}
            clubLogo={identity.displayLogo}
            clubId={club.id}
            publisherRole={club.role}
            identity={identity}
            palette={coverPalette}
            onClose={handleClose}
            countryFlag={worldClub?.flagEmoji ?? null}
            league={leagueForPhone}
            hasApplied={hasApplied}
            applicationStatus={applicationStatus}
            canApply={canShowApplyButton}
            isPublisher={Boolean(user && user.id === opportunity.club_id)}
            isClosed={isClosed}
            onApply={handleApplyClick}
            onMessage={handleMessageClick}
            ownApplicationSlot={applicationId && applicationStatus ? (
              <OwnApplicationRoad applicationId={applicationId} status={applicationStatus} onMessage={handleMessageClick} onSeeOffer={() => handleMessageClick('offer')} onChanged={setApplicationStatus} />
            ) : undefined}
          />
        </div>
        )}
        {isDesktop && (
        <div className="hidden pt-16 lg:block">
          {/* Desktop (Figma D2 194:885): the role as a page with a sticky cover column. */}
          <OpportunityDetailDesktop
            vacancy={opportunity}
            clubName={identity.displayName}
            clubLogo={identity.displayLogo}
            clubId={club.id}
            publisherRole={club.role}
            identity={identity}
            palette={coverPalette}
            onClose={handleClose}
            countryFlag={worldClub?.flagEmoji ?? null}
            league={leagueForPhone}
            hasApplied={hasApplied}
            applicationStatus={applicationStatus}
            canApply={canShowApplyButton}
            isPublisher={Boolean(user && user.id === opportunity.club_id)}
            isClosed={isClosed}
            onApply={handleApplyClick}
            onMessage={handleMessageClick}
            ownApplicationSlot={applicationId && applicationStatus ? (
              <OwnApplicationRoad applicationId={applicationId} status={applicationStatus} onMessage={handleMessageClick} onSeeOffer={() => handleMessageClick('offer')} onChanged={setApplicationStatus} />
            ) : undefined}
          />
        </div>
        )}
      </div>

      {/* Sign In Prompt Modal - for unauthenticated users */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title={wallTitle}
        action={wallTitle.includes('message') ? 'message' : 'apply'}
        message="Sign in or create a free HOCKIA account to apply to this opportunity."
      />

      {/* Apply Modal */}
      {opportunity && (
        <ApplyToOpportunityModal
          isOpen={showApplyModal}
          onClose={() => setShowApplyModal(false)}
          vacancy={opportunity}
          clubName={worldClub?.clubName || club.full_name}
          clubLogo={worldClub?.avatarUrl || club.avatar_url}
          publisherRole={club.role}
          league={leagueForPhone}
          identity={identity}
          source={navSource}
          onSuccess={(vacancyId) => {
            void vacancyId
            // ⚡ OPTIMISTIC UPDATE: Instant UI feedback
            setHasApplied(true)
            
            // Background sync to ensure consistency
            refreshApplicationStatus()
          }}
          onError={(vacancyId) => {
            void vacancyId
            // 🔄 ROLLBACK: Revert optimistic update on error
            setHasApplied(false)
            refreshApplicationStatus()
          }}
        />
      )}
    </>
  )
}
