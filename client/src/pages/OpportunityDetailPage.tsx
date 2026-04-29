import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import { logger } from '../lib/logger'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackVacancyView } from '../lib/analytics'
import type { Opportunity } from '../lib/supabase'
import Header from '../components/Header'
import OpportunityDetailView from '../components/OpportunityDetailView'
import ApplyToOpportunityModal from '../components/ApplyToOpportunityModal'
import SignInPromptModal from '../components/SignInPromptModal'
import OpportunityJsonLd from '../components/OpportunityJsonLd'
import Breadcrumbs from '../components/Breadcrumbs'

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuthStore()
  const isCurrentUserTestAccount = profile?.is_test_account ?? false
  
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [club, setClub] = useState<{ id: string; full_name: string | null; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null } | null>(null)
  const [worldClub, setWorldClub] = useState<{ id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null } | null>(null)
  const [hasApplied, setHasApplied] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isClosed, setIsClosed] = useState(false)

  const fetchVacancyDetails = useCallback(async () => {
    if (!id) return

    try {
      // Fetch opportunity with club details including is_test_account
      const { data: opportunityData, error: opportunityError } = await supabase
        .from('opportunities')
        .select(`
          *,
          club:profiles!opportunities_club_id_fkey(
            id,
            full_name,
            avatar_url,
            is_test_account,
            role,
            current_club,
            womens_league_division,
            mens_league_division
          ),
          world_club:world_clubs!opportunities_world_club_id_fkey(
            id,
            club_name,
            avatar_url,
            country:countries(name, flag_emoji),
            men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier),
            women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier)
          )
        `)
        .eq('id', id)
        .single()

      if (opportunityError || !opportunityData) {
        logger.error('Opportunity not found:', opportunityError)
        setNotFound(true)
        return
      }

      if (opportunityData.status !== 'open') {
        setIsClosed(true)
      } else if (opportunityData.application_deadline) {
        // Check if deadline has passed (treat as closed even if status wasn't updated)
        const deadline = new Date(opportunityData.application_deadline)
        if (deadline < new Date()) {
          setIsClosed(true)
        }
      }

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
        club?: { id: string; full_name: string | null; avatar_url: string | null; is_test_account?: boolean; role?: string | null; current_club?: string | null; womens_league_division?: string | null; mens_league_division?: string | null }
        world_club?: WorldClubJoin
      }
      if (opportunityWithClub.club?.is_test_account && !isCurrentUserTestAccount) {
        // Real users cannot view test opportunities
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
      if (user && (profile?.role === 'player' || profile?.role === 'coach')) {
        const { data: applicationData } = await supabase
          .from('opportunity_applications')
          .select('id')
          .eq('opportunity_id', id)
          .eq('applicant_id', user.id)
          .single()

        setHasApplied(!!applicationData)
      }
    } catch (error) {
      logger.error('Error fetching opportunity details:', error)
      setNotFound(true)
    } finally {
      setIsLoading(false)
    }
  }, [id, user, profile, isCurrentUserTestAccount])

  useEffect(() => {
    if (!id) {
      navigate('/opportunities')
      return
    }

    fetchVacancyDetails()
  }, [id, navigate, fetchVacancyDetails])

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
    })
    trackVacancyView(opportunity.id, opportunity.position ?? undefined, opportunity.location_city ?? undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.id])

  const refreshApplicationStatus = async () => {
    // Allow both players and coaches to refresh their application status
    if (!id || !user || !['player', 'coach'].includes(profile?.role ?? '')) return

    const { data } = await supabase
      .from('opportunity_applications')
      .select('id')
      .eq('opportunity_id', id)
      .eq('applicant_id', user.id)
      .single()

    setHasApplied(!!data)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 80px)', paddingTop: '80px' }}>
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading opportunity...</p>
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
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Opportunity Not Found</h1>
            <p className="text-gray-600 mb-6">This opportunity may have been removed.</p>
            <button
              onClick={() => navigate('/opportunities')}
              className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Browse Opportunities
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (isClosed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 80px)', paddingTop: '80px' }}>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">This Opportunity Has Closed</h1>
            <p className="text-gray-600 mb-6">This position is no longer accepting applications.</p>
            <button
              onClick={() => navigate('/opportunities')}
              className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Browse Open Opportunities
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Determine what happens when user clicks "Apply"
  const handleApplyClick = () => {
    if (!user) {
      // Not authenticated - show sign-in prompt
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

  // Determine if user can apply (or should see the apply button)
  const canShowApplyButton = !hasApplied && (
    !user || // Not logged in - show button to trigger sign-in prompt
    (profile?.role === 'player' && opportunity.opportunity_type === 'player') ||
    (profile?.role === 'coach' && opportunity.opportunity_type === 'coach')
  )

  return (
    <>
      {/* Structured data for AI discoverability */}
      <OpportunityJsonLd
        vacancy={opportunity} 
        club={{
          name: club.full_name || 'Unknown Club',
          logoUrl: club.avatar_url,
        }}
      />
      
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="pt-20">
          <div className="max-w-4xl mx-auto px-4 md:px-6 pt-4 pb-2">
            <Breadcrumbs
              items={[
                { label: 'Opportunities', to: '/opportunities' },
                { label: opportunity.title },
              ]}
            />
          </div>
          <OpportunityDetailView
            vacancy={opportunity}
            clubName={club.full_name || 'Unknown Club'}
            clubLogo={club.avatar_url}
            clubId={club.id}
            publisherRole={club.role}
            publisherOrganization={opportunity.organization_name || club.current_club || null}
            leagueDivision={(() => {
              // Phase 3d — Women + Girls families map to women's league;
              // Men + Boys to men's; Mixed defaults to first available.
              const womensFamily = opportunity.gender === 'Women' || opportunity.gender === 'Girls'
              return womensFamily
                ? club.womens_league_division ?? club.mens_league_division ?? null
                : club.mens_league_division ?? club.womens_league_division ?? null
            })()}
            worldClub={worldClub}
            onClose={() => navigate('/opportunities')}
            onApply={canShowApplyButton ? handleApplyClick : undefined}
            hasApplied={hasApplied}
          />
        </div>
      </div>

      {/* Sign In Prompt Modal - for unauthenticated users */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to apply"
        message="Sign in or create a free HOCKIA account to apply to this opportunity."
      />

      {/* Apply Modal */}
      {opportunity && (
        <ApplyToOpportunityModal
          isOpen={showApplyModal}
          onClose={() => setShowApplyModal(false)}
          vacancy={opportunity}
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
