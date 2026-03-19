/**
 * WorldProvincePage - Province detail page for region-based countries
 *
 * Shows league tabs + inline club list for a province.
 * Example: /world/ar/buenos-aires → Buenos Aires leagues as tabs, clubs inline
 *
 * Also handles legacy direct-league URLs for region-less countries
 * by redirecting to the country page.
 */

import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Building2, Trophy, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import { Header } from '@/components'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface League {
  id: number
  name: string
  slug: string | null
  tier: number | null
  display_order: number | null
  club_count: number
}

interface Province {
  id: number
  name: string
  slug: string
  description: string | null
}

interface Club {
  id: string
  club_id: string
  club_name: string
  is_claimed: boolean
  claimed_profile_id: string | null
  profile_username?: string | null
  profile_avatar_url?: string | null
}

interface Country {
  id: number
  code: string
  name: string
  flag_emoji: string | null
}

interface RawLeague {
  id: number
  name: string
  slug: string | null
  tier: number | null
  display_order: number | null
}

interface ClubLeagueRow {
  id: string
  women_league_id: number | null
  men_league_id: number | null
}

export default function WorldProvincePage() {
  const { countrySlug, provinceSlug } = useParams<{ countrySlug: string; provinceSlug: string }>()
  const navigate = useNavigate()

  const [country, setCountry] = useState<Country | null>(null)
  const [province, setProvince] = useState<Province | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [searchParams] = useSearchParams()
  const highlightClubId = searchParams.get('club')
  const targetLeagueId = searchParams.get('league')
  const targetGender = searchParams.get('gender') as 'women' | 'men' | null
  const [genderFilter, setGenderFilter] = useState<'women' | 'men'>(targetGender === 'men' ? 'men' : 'women')

  // Raw data cached once — league counts derived via useMemo
  const [rawLeagues, setRawLeagues] = useState<RawLeague[]>([])
  const [allClubData, setAllClubData] = useState<ClubLeagueRow[]>([])
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null)
  const [clubs, setClubs] = useState<Club[]>([])
  const [clubsLoading, setClubsLoading] = useState(false)

  const flagUrl = useMemo(() => {
    if (!country) return ''
    if (country.code === 'XE') return 'https://flagcdn.com/w160/gb-eng.png'
    return `https://flagcdn.com/w160/${country.code.toLowerCase()}.png`
  }, [country])

  // Derive league counts from cached club data — no refetch on gender toggle
  const leagues = useMemo(() => {
    const col = genderFilter === 'women' ? 'women_league_id' : 'men_league_id'
    const counts = new Map<number, number>()
    for (const club of allClubData) {
      const lid = club[col]
      if (lid) counts.set(lid, (counts.get(lid) || 0) + 1)
    }
    return rawLeagues.map(l => ({ ...l, club_count: counts.get(l.id) || 0 }))
  }, [rawLeagues, allClubData, genderFilter])

  // Auto-select league: prefer target from search params, else first with clubs
  useEffect(() => {
    if (leagues.length === 0) {
      setSelectedLeague(null)
      setClubs([])
      return
    }
    if (targetLeagueId) {
      const target = leagues.find(l => l.id === Number(targetLeagueId))
      if (target) {
        setSelectedLeague(target)
        return
      }
    }
    const firstWithClubs = leagues.find(l => l.club_count > 0)
    setSelectedLeague(firstWithClubs || leagues[0])
  }, [leagues, targetLeagueId])

  useEffect(() => {
    if (!countrySlug || !provinceSlug) return

    const fetchData = async () => {
      try {
        setError(false)
        setLoading(true)

        // Get country
        const { data: countryData, error: countryError } = await supabase
          .from('countries')
          .select('id, code, name, flag_emoji')
          .eq('code', countrySlug.toUpperCase())
          .single()

        if (countryError) throw countryError
        setCountry(countryData)

        // Try to find a province with this slug
        const { data: provinceData, error: provinceError } = await supabase
          .from('world_provinces')
          .select('id, name, slug, description')
          .eq('country_id', countryData.id)
          .eq('slug', provinceSlug)
          .single()

        if (!provinceError && provinceData) {
          setProvince(provinceData)
          document.title = `${provinceData.name} | ${countryData.name} | HOCKIA`
          await fetchLeaguesAndClubData(provinceData.id)
        } else {
          navigate(`/world/${countrySlug}`, { replace: true })
          return
        }
      } catch (err) {
        logger.error('[WorldProvincePage] Failed to fetch data:', err)
        setError(true)
      } finally {

        setLoading(false)
      }
    }

    fetchData()
  }, [countrySlug, provinceSlug, retryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch clubs when selected league or gender changes
  useEffect(() => {
    if (selectedLeague && province) {
      fetchClubsForLeague(province.id, selectedLeague.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeague, genderFilter])

  const fetchLeaguesAndClubData = async (provinceId: number) => {
    try {
      // Parallel: leagues + all club league assignments (both genders)
      const [leagueRes, clubRes] = await Promise.all([
        supabase
          .from('world_leagues')
          .select('id, name, slug, tier, display_order')
          .eq('province_id', provinceId)
          .order('display_order'),
        supabase
          .from('world_clubs')
          .select('id, women_league_id, men_league_id')
          .eq('province_id', provinceId),
      ])

      if (leagueRes.error) throw leagueRes.error
      setRawLeagues(leagueRes.data || [])
      setAllClubData((clubRes.data as ClubLeagueRow[]) || [])
    } catch (err) {
      logger.error('[WorldProvincePage] Failed to fetch leagues:', err)
    }
  }

  const fetchClubsForLeague = async (provinceId: number, leagueId: number) => {
    try {
      setClubsLoading(true)
      const leagueColumn = genderFilter === 'women' ? 'women_league_id' : 'men_league_id'

      // avatar_url added in migration 202602190500 but not yet in generated types
      type ClubRow = { id: string; club_id: string; club_name: string; avatar_url: string | null; is_claimed: boolean; claimed_profile_id: string | null }
      const { data: clubData, error: clubError } = await supabase
        .from('world_clubs')
        .select('id, club_id, club_name, avatar_url, is_claimed, claimed_profile_id')
        .eq('province_id', provinceId)
        .eq(leagueColumn, leagueId)
        .order('is_claimed', { ascending: false })
        .order('club_name')
        .returns<ClubRow[]>()

      if (clubError) throw clubError

      // Get usernames and avatars for claimed clubs
      const claimedIds = (clubData || [])
        .filter(c => c.claimed_profile_id)
        .map(c => c.claimed_profile_id)
        .filter((id): id is string => id !== null)

      const profileMap = new Map<string, { username: string | null; avatar_url: string | null }>()
      if (claimedIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', claimedIds)

        for (const p of profiles || []) {
          profileMap.set(p.id, { username: p.username, avatar_url: p.avatar_url })
        }
      }

      const transformedClubs = (clubData || []).map(club => {
        const profile = club.claimed_profile_id ? profileMap.get(club.claimed_profile_id) : null
        // Treat as unclaimed if claimed_profile_id is missing (orphaned claim)
        const effectivelyClaimed = club.is_claimed && !!club.claimed_profile_id
        return {
          id: club.id,
          club_id: club.club_id,
          club_name: club.club_name,
          is_claimed: effectivelyClaimed,
          claimed_profile_id: club.claimed_profile_id,
          profile_username: profile?.username ?? null,
          profile_avatar_url: profile?.avatar_url ?? club.avatar_url ?? null,
        }
      })

      setClubs(transformedClubs)
    } catch (err) {
      logger.error('[WorldProvincePage] Failed to fetch clubs:', err)
    } finally {
      setClubsLoading(false)
    }
  }

  // Scroll to highlighted club from search params (once)
  useEffect(() => {
    if (!highlightClubId || clubs.length === 0) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-club-id="${highlightClubId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }, [clubs, highlightClubId])

  const handleClubClick = (club: Club) => {
    if (club.is_claimed && club.profile_username) {
      navigate(`/clubs/${club.profile_username}`)
    } else if (club.is_claimed && club.claimed_profile_id) {
      navigate(`/clubs/id/${club.claimed_profile_id}`)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-8" />
            <div className="flex gap-3 mb-6">
              <div className="h-10 bg-gray-200 rounded-full w-24" />
              <div className="h-10 bg-gray-200 rounded-full w-32" />
              <div className="h-10 bg-gray-200 rounded-full w-28" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-200" />
                    <div className="h-5 bg-gray-200 rounded w-40" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Error state with retry
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-700 font-medium mb-1">Unable to load region data</p>
            <p className="text-sm text-gray-500 mb-4">Check your connection and try again</p>
            <div className="flex items-center justify-center gap-3">
              <Link to={`/world/${countrySlug}`} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Back to Country
              </Link>
              <button
                type="button"
                onClick={() => setRetryCount(c => c + 1)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Not found state
  if (!country || !province) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6 text-center">
          <p className="text-gray-600">Region not found</p>
          <button
            type="button"
            onClick={() => navigate('/world')}
            className="mt-4 text-[#8026FA] hover:underline"
          >
            Back to World
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
        {/* Back Button */}
        <button
          type="button"
          onClick={() => navigate(`/world/${countrySlug}`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-2 border-sky-200 overflow-hidden">
              <img
                src={flagUrl}
                alt={`${country.name} flag`}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const span = document.createElement('span');
                  span.className = 'text-3xl';
                  span.textContent = country.flag_emoji || '';
                  const parent = target.parentElement!;
                  parent.replaceChildren(span);
                  parent.className = 'w-16 h-16 rounded-full bg-gradient-to-br from-sky-100 to-white border-2 border-sky-200 flex items-center justify-center';
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Link to="/world" className="hover:text-gray-700">World</Link>
                <span>/</span>
                <Link to={`/world/${countrySlug}`} className="text-[#8026FA] hover:underline">
                  {country.name}
                </Link>
                <span>/</span>
                <span className="text-[#8026FA]">{province.name}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{province.name}</h1>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <div className="px-3 py-1.5 bg-[#8026FA]/10 rounded-full text-sm text-[#8026FA] font-medium">
              <Trophy className="w-4 h-4 inline mr-1" />
              {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}
            </div>
          </div>
        </div>

        {/* Gender + League Tabs Row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          {/* Gender Toggle */}
          <div className="inline-flex bg-gray-100 rounded-full p-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setGenderFilter('women')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                genderFilter === 'women'
                  ? 'bg-[#8026FA] text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Women
            </button>
            <button
              type="button"
              onClick={() => setGenderFilter('men')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                genderFilter === 'men'
                  ? 'bg-[#8026FA] text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Men
            </button>
          </div>

          {/* League Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {leagues.map((league) => (
              <button
                type="button"
                key={league.id}
                onClick={() => setSelectedLeague(league)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all border ${
                  selectedLeague?.id === league.id
                    ? 'bg-white border-[#8026FA] text-[#8026FA] shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {league.name}
                <span className="ml-1.5 text-xs opacity-70">{league.club_count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Clubs List */}
        {clubsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200" />
                  <div className="h-5 bg-gray-200 rounded w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : leagues.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
            <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No leagues found for {genderFilter === 'women' ? "women's" : "men's"} hockey</p>
          </div>
        ) : clubs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No clubs in this league yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Clubs will appear here once they join the platform
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {clubs.map((club) => (
              <button
                type="button"
                key={club.id}
                data-club-id={club.id}
                onClick={() => handleClubClick(club)}
                disabled={!club.is_claimed}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  highlightClubId === club.id
                    ? 'bg-white border-[#8026FA] ring-2 ring-[#8026FA] ring-offset-2 shadow-md'
                    : club.is_claimed
                      ? 'bg-white border-gray-200 hover:border-[#8026FA] hover:shadow-md cursor-pointer'
                      : 'bg-gray-50 border-gray-100 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {club.profile_avatar_url ? (
                      <img
                        src={club.profile_avatar_url}
                        alt={club.club_name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        club.is_claimed
                          ? 'bg-gradient-to-br from-[#8026FA] to-[#924CEC]'
                          : 'bg-gray-200'
                      }`}>
                        <Building2 className={`w-5 h-5 ${club.is_claimed ? 'text-white' : 'text-gray-400'}`} />
                      </div>
                    )}
                    <div>
                      <h3 className={`font-medium ${club.is_claimed ? 'text-gray-900' : 'text-gray-500'}`}>
                        {club.club_name}
                      </h3>
                      {club.profile_username && (
                        <p className="text-sm text-gray-500">@{club.profile_username}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {club.is_claimed ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        <Clock className="w-3 h-3" />
                        Unclaimed
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
