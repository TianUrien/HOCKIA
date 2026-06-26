import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import { logger } from '../lib/logger'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackVacancyView } from '../lib/analytics'
import type { Opportunity } from '../lib/supabase'

export interface OpportunityDetailClub {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  current_club: string | null
  womens_league_division: string | null
  mens_league_division: string | null
}

export interface OpportunityDetailWorldClub {
  id: string
  clubName: string
  avatarUrl: string | null
  countryName: string | null
  flagEmoji: string | null
  leagueName: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fetches a single opportunity + its club / world-club for the detail surfaces.
 * Shared by the route page (OpportunityDetailPage) and the in-app overlay
 * (OpportunityDetailOverlay) so the deep-link page and the Home-feed modal use
 * ONE source of truth for the fetch, the test-account/staging gate, the
 * status-is-closed rule, and the has-applied check.
 */
export function useOpportunityDetail(id: string | undefined) {
  const { user, profile } = useAuthStore()
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [club, setClub] = useState<OpportunityDetailClub | null>(null)
  const [worldClub, setWorldClub] = useState<OpportunityDetailWorldClub | null>(null)
  const [hasApplied, setHasApplied] = useState(false)
  // The applicant's OWN application id + status — powers the status badge and the
  // application timeline on the in-app overlay/modal path (not just the full page).
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isClosed, setIsClosed] = useState(false)

  const isCurrentUserTestAccount = profile?.is_test_account ?? false
  // On staging the opportunities list shows test-account postings to everyone;
  // the detail surfaces must match or a listed opportunity 404s on click-through.
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')

  const fetchDetails = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setNotFound(false)
    setIsClosed(false)
    try {
      // opportunities.id is a uuid — a non-uuid makes PostgREST throw; render
      // the friendly not-found instead of crashing.
      if (!UUID_RE.test(id)) {
        logger.debug('Opportunity id is not a valid uuid:', id)
        setNotFound(true)
        return
      }

      const { data: opportunityData, error: opportunityError } = await supabase
        .from('opportunities')
        .select(`
          *,
          club:profiles!opportunities_club_id_fkey(
            id, full_name, avatar_url, is_test_account, role, current_club,
            womens_league_division, mens_league_division
          ),
          world_club:world_clubs!opportunities_world_club_id_fkey(
            id, club_name, avatar_url,
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

      // Status is the single source of truth for closed/open — a passed
      // application_deadline does NOT auto-close it.
      if (opportunityData.status !== 'open') {
        setIsClosed(true)
      }

      type WorldClubJoin = {
        id: string
        club_name: string
        avatar_url: string | null
        country: { name: string; flag_emoji: string | null } | null
        men_league: { name: string; tier: number | null } | null
        women_league: { name: string; tier: number | null } | null
      } | null
      const withClub = opportunityData as Opportunity & {
        club?: { id: string; full_name: string | null; avatar_url: string | null; is_test_account?: boolean; role?: string | null; current_club?: string | null; womens_league_division?: string | null; mens_league_division?: string | null }
        world_club?: WorldClubJoin
      }

      if (withClub.club?.is_test_account && !isCurrentUserTestAccount && !isStaging) {
        logger.debug('Test opportunity not accessible to non-test user')
        setNotFound(true)
        return
      }

      setOpportunity(opportunityData as Opportunity)

      if (withClub.club) {
        setClub({
          id: withClub.club.id,
          full_name: withClub.club.full_name,
          avatar_url: withClub.club.avatar_url,
          role: withClub.club.role ?? null,
          current_club: withClub.club.current_club ?? null,
          womens_league_division: withClub.club.womens_league_division ?? null,
          mens_league_division: withClub.club.mens_league_division ?? null,
        })
      }

      if (withClub.world_club) {
        const wc = withClub.world_club
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

      if (user && (profile?.role === 'player' || profile?.role === 'coach')) {
        const { data: applicationData } = await supabase
          .from('opportunity_applications')
          .select('id, status')
          .eq('opportunity_id', id)
          .eq('applicant_id', user.id)
          .maybeSingle()
        setHasApplied(!!applicationData)
        setApplicationId((applicationData as { id?: string } | null)?.id ?? null)
        setApplicationStatus((applicationData as { status?: string } | null)?.status ?? null)
      }
    } catch (error) {
      logger.error('Error fetching opportunity details:', error)
      setNotFound(true)
    } finally {
      setIsLoading(false)
    }
  }, [id, user, profile, isCurrentUserTestAccount, isStaging])

  useEffect(() => {
    fetchDetails()
  }, [fetchDetails])

  // Track the view once the opportunity resolves.
  useEffect(() => {
    if (!opportunity) return
    trackDbEvent('vacancy_view', 'vacancy', opportunity.id, {
      position: opportunity.position ?? undefined,
      location: opportunity.location_city ?? undefined,
    })
    void trackVacancyView(opportunity.id, opportunity.position ?? undefined, opportunity.location_city ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.id])

  const refreshApplicationStatus = useCallback(async () => {
    if (!id || !user || !['player', 'coach'].includes(profile?.role ?? '')) return
    const { data } = await supabase
      .from('opportunity_applications')
      .select('id, status')
      .eq('opportunity_id', id)
      .eq('applicant_id', user.id)
      .maybeSingle()
    setHasApplied(!!data)
    setApplicationId((data as { id?: string } | null)?.id ?? null)
    setApplicationStatus((data as { status?: string } | null)?.status ?? null)
  }, [id, user, profile?.role])

  return {
    opportunity,
    club,
    worldClub,
    hasApplied,
    applicationId,
    applicationStatus,
    isLoading,
    notFound,
    isClosed,
    setHasApplied,
    refreshApplicationStatus,
  }
}
