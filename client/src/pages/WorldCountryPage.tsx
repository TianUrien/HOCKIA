/**
 * WorldCountryPage - Country detail page
 *
 * For countries WITH regions (Argentina, Australia): Shows region cards
 * For countries WITHOUT regions (England, Italy, Germany): Shows league tabs + inline clubs
 */

import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, MapPin, Building2, Trophy, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import { Header } from '@/components'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface Province {
  province_id: number | null
  province_name: string | null
  slug: string | null
  description: string | null
  display_order: number | null
  total_clubs: number | null
  claimed_clubs: number | null
  total_leagues: number | null
}

interface League {
  id: number
  name: string
  slug: string | null
  tier: number | null
  display_order: number | null
  club_count: number
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
  region: string | null
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

export default function WorldCountryPage() {
  const { countrySlug } = useParams<{ countrySlug: string }>()
  const navigate = useNavigate()
  const [country, setCountry] = useState<Country | null>(null)
  const [hasRegions, setHasRegions] = useState<boolean | null>(null)
  const [provinces, setProvinces] = useState<Province[]>([])
  const [rawLeagues, setRawLeagues] = useState<RawLeague[]>([])
  const [allClubData, setAllClubData] = useState<ClubLeagueRow[]>([])
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null)
  const [clubs, setClubs] = useState<Club[]>([])
  const [clubsLoading, setClubsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [searchParams] = useSearchParams()
  const highlightClubId = searchParams.get('club')
  const targetLeagueId = searchParams.get('league')
  const targetGender = searchParams.get('gender') as 'women' | 'men' | null
  const [genderFilter, setGenderFilter] = useState<'women' | 'men'>(targetGender === 'men' ? 'men' : 'women')

  // Compute the correct flag URL based on country code
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
    if (!countrySlug) return

    const fetchCountryData = async () => {
      try {
        setError(false)
        setLoading(true)

        // Single query: country info + has_regions + counts from the view
        const { data, error: fetchErr } = await supabase
          .from('world_countries_with_directory')
          .select('*')
          .eq('country_code', countrySlug.toUpperCase())
          .single()

        if (fetchErr) throw fetchErr

        const cid = data.country_id ?? 0
        const countryData: Country = {
          id: cid,
          code: data.country_code ?? '',
          name: data.country_name ?? '',
          flag_emoji: data.flag_emoji,
          region: data.region,
        }
        setCountry(countryData)
        setHasRegions(data.has_regions ?? false)
        document.title = `${countryData.name} | World | HOCKIA`

        if (data.has_regions) {
          const { data: provinceData, error: provinceError } = await supabase
            .from('world_province_stats')
            .select('*')
            .eq('country_id', cid)
            .order('display_order')

          if (provinceError) throw provinceError
          setProvinces(provinceData || [])
        } else {
          // Fetch leagues + all club league assignments in parallel (once)
          await fetchLeaguesAndClubData(cid)
        }
      } catch (err) {
        logger.error('[WorldCountryPage] Failed to fetch data:', err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    fetchCountryData()
  }, [countrySlug, retryCount])

  // Fetch clubs when selected league changes
  useEffect(() => {
    if (selectedLeague && country) {
      fetchClubsForLeague(country.id, selectedLeague.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeague, genderFilter])

  const fetchLeaguesAndClubData = async (countryId: number) => {
    try {
      // Parallel: leagues + all club league assignments (both genders)
      const [leagueRes, clubRes] = await Promise.all([
        supabase
          .from('world_leagues')
          .select('id, name, slug, tier, display_order')
          .eq('country_id', countryId)
          .is('province_id', null)
          .order('tier')
          .order('display_order'),
        supabase
          .from('world_clubs')
          .select('id, women_league_id, men_league_id')
          .eq('country_id', countryId),
      ])

      if (leagueRes.error) throw leagueRes.error
      setRawLeagues(leagueRes.data || [])
      setAllClubData((clubRes.data as ClubLeagueRow[]) || [])
    } catch (err) {
      logger.error('[WorldCountryPage] Failed to fetch leagues:', err)
    }
  }

  const fetchClubsForLeague = async (countryId: number, leagueId: number) => {
    try {
      setClubsLoading(true)
      const leagueColumn = genderFilter === 'women' ? 'women_league_id' : 'men_league_id'

      // avatar_url added in migration 202602190500 but not yet in generated types
      type ClubRow = { id: string; club_id: string; club_name: string; avatar_url: string | null; is_claimed: boolean; claimed_profile_id: string | null }
      const { data: clubData, error: clubError } = await supabase
        .from('world_clubs')
        .select('id, club_id, club_name, avatar_url, is_claimed, claimed_profile_id')
        .eq('country_id', countryId)
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
      logger.error('[WorldCountryPage] Failed to fetch clubs:', err)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-48 mb-8" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="h-12 w-12 bg-gray-200 rounded-full mx-auto mb-4" />
                  <div className="h-5 bg-gray-200 rounded w-24 mx-auto mb-2" />
                  <div className="h-4 bg-gray-100 rounded w-32 mx-auto" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-700 font-medium mb-1">Unable to load country data</p>
            <p className="text-sm text-gray-500 mb-4">Check your connection and try again</p>
            <div className="flex items-center justify-center gap-3">
              <Link to="/world" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Back to World
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

  if (!country) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="text-center py-12">
            <p className="text-gray-500">Country not found</p>
            <Link to="/world" className="text-blue-600 hover:underline mt-2 inline-block">
              Back to World
            </Link>
          </div>
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
          onClick={() => navigate('/world')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {/* Country Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden shadow-md border border-gray-200">
              <img
                src={flagUrl}
                alt={`${country.name} flag`}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const span = document.createElement('span');
                  span.className = 'text-4xl';
                  span.textContent = country.flag_emoji || '';
                  const parent = target.parentElement!;
                  parent.replaceChildren(span);
                  parent.className = 'w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center';
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Link to="/world" className="hover:text-gray-700">World</Link>
                <span>/</span>
                <span className="text-[#8026FA]">{country.name}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{country.name}</h1>
            </div>
          </div>
        </div>

        {/* Gradient Bar */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-500 to-purple-500 rounded-full mb-8" />

        {hasRegions ? (
          /* ===== REGION-BASED COUNTRIES ===== */
          <>
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Regions</h2>
              <p className="text-gray-600 mb-6">
                Select a region to explore leagues and clubs in {country.name}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {provinces.map((province) => (
                  <div
                    key={province.province_id}
                    onClick={() => navigate(`/world/${countrySlug}/${province.slug}`)}
                    className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg hover:border-blue-200 transition-all cursor-pointer text-center"
                  >
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MapPin className="w-7 h-7 text-blue-500" />
                    </div>
                    <h3 className="font-semibold text-gray-900 text-lg mb-1">{province.province_name}</h3>
                    <p className="text-sm text-gray-500 mb-4">{province.description}</p>

                    <div className="flex flex-wrap justify-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        <Trophy className="w-3 h-3" />
                        {province.total_leagues} {province.total_leagues === 1 ? 'league' : 'leagues'}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        <Building2 className="w-3 h-3" />
                        {province.total_clubs} {province.total_clubs === 1 ? 'club' : 'clubs'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{country.name}'s Hockey Structure</h3>
                  <p className="text-sm text-gray-600">
                    {country.name} organizes its hockey system by region. Each region manages its own leagues and tournaments.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ===== REGION-LESS COUNTRIES: League Tabs + Inline Clubs ===== */
          <>
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
          </>
        )}
      </main>
    </div>
  )
}
