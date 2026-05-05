import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2, MapPin, Trophy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { Header, Layout, Avatar, VerifiedBadge, PendingVerificationBadge } from '@/components'

/**
 * WorldClubPage — leaf-level page for a single world_clubs row.
 *
 * Reachable from notification deep-links and from "View club on World"
 * CTAs in OpportunityCard / OpportunityDetailView. Before this existed
 * those navigates 404'd silently.
 *
 * Minimal v1: name, logo, location, leagues, link to claimed profile if
 * the club is claimed. No member list (defer to a later iteration —
 * tied to the club affiliation question that's a separate audit item).
 */

type ClubRow = {
  id: string
  club_id: string
  club_name: string
  avatar_url: string | null
  is_claimed: boolean
  claimed_profile_id: string | null
  country_id: number | null
  province_id: number | null
  men_league_id: number | null
  women_league_id: number | null
}

type CountryRow = { id: number; code: string; name: string; flag_emoji: string | null }
type ProvinceRow = { id: number; name: string; slug: string }
type LeagueRow = { id: number; name: string; tier: string | null }
type ClaimedProfileRow = {
  id: string
  username: string | null
  full_name: string | null
  avatar_url: string | null
  is_verified: boolean | null
  verified_at: string | null
}

export default function WorldClubPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [club, setClub] = useState<ClubRow | null>(null)
  const [country, setCountry] = useState<CountryRow | null>(null)
  const [province, setProvince] = useState<ProvinceRow | null>(null)
  const [menLeague, setMenLeague] = useState<LeagueRow | null>(null)
  const [womenLeague, setWomenLeague] = useState<LeagueRow | null>(null)
  const [claimedProfile, setClaimedProfile] = useState<ClaimedProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const { data: clubData, error: clubErr } = await supabase
          .from('world_clubs')
          .select('id, club_id, club_name, avatar_url, is_claimed, claimed_profile_id, country_id, province_id, men_league_id, women_league_id')
          .eq('id', id)
          .maybeSingle()
          .returns<ClubRow | null>()

        if (cancelled) return
        if (clubErr) throw clubErr
        if (!clubData) {
          setNotFound(true)
          return
        }
        setClub(clubData)
        document.title = `${clubData.club_name} | HOCKIA`

        // Fan out lookups sequentially. Each is a small single-row read
        // and the user-perceived load time is dominated by the initial
        // club fetch above; not worth fighting the supabase-js type
        // gymnastics required to Promise.all the builders.
        if (clubData.country_id) {
          const { data } = await supabase
            .from('countries')
            .select('id, code, name, flag_emoji')
            .eq('id', clubData.country_id)
            .maybeSingle()
          if (cancelled) return
          setCountry(data as CountryRow | null)
        }
        if (clubData.province_id) {
          const { data } = await supabase
            .from('world_provinces')
            .select('id, name, slug')
            .eq('id', clubData.province_id)
            .maybeSingle()
          if (cancelled) return
          setProvince(data as ProvinceRow | null)
        }
        if (clubData.men_league_id) {
          const { data } = await supabase
            .from('world_leagues')
            .select('id, name, tier')
            .eq('id', clubData.men_league_id)
            .maybeSingle()
          if (cancelled) return
          setMenLeague(data as LeagueRow | null)
        }
        if (clubData.women_league_id) {
          const { data } = await supabase
            .from('world_leagues')
            .select('id, name, tier')
            .eq('id', clubData.women_league_id)
            .maybeSingle()
          if (cancelled) return
          setWomenLeague(data as LeagueRow | null)
        }
        if (clubData.is_claimed && clubData.claimed_profile_id) {
          const { data } = await supabase
            .from('profiles')
            .select('id, username, full_name, avatar_url, is_verified, verified_at')
            .eq('id', clubData.claimed_profile_id)
            .maybeSingle()
          if (cancelled) return
          setClaimedProfile(data as ClaimedProfileRow | null)
        }
      } catch (err) {
        logger.error('[WorldClubPage] failed to load', err)
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <Layout>
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Loading club" />
        </div>
      </Layout>
    )
  }

  if (notFound || !club) {
    return (
      <Layout>
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Club not found</p>
          <p className="max-w-md text-sm text-gray-500">
            This club may have been removed from the directory. Browse the World to find clubs by country and province.
          </p>
          <Link to="/world" className="text-sm font-medium text-[#8026FA] hover:text-[#6B20D4]">
            Go to World
          </Link>
        </div>
      </Layout>
    )
  }

  const claimedProfilePath = claimedProfile
    ? (claimedProfile.username ? `/clubs/${claimedProfile.username}` : `/clubs/id/${claimedProfile.id}`)
    : null

  const provinceHref = country && province
    ? `/world/${country.code.toLowerCase()}/${province.slug}`
    : country
      ? `/world/${country.code.toLowerCase()}`
      : '/world'

  return (
    <Layout>
      <Header />
      <div className="flex-1 bg-gray-50 pt-[var(--app-header-offset)]">
        <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
            <div className="flex items-start gap-4 md:gap-6">
              <Avatar
                src={club.avatar_url}
                initials={club.club_name.slice(0, 2).toUpperCase()}
                size="lg"
                role="club"
              />
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-gray-900 md:text-3xl">
                  <span>{club.club_name}</span>
                  {claimedProfile && (
                    <>
                      <VerifiedBadge
                        verified={claimedProfile.is_verified}
                        verifiedAt={claimedProfile.verified_at}
                      />
                      <PendingVerificationBadge verified={claimedProfile.is_verified} />
                    </>
                  )}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                  {(country || province) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      {province?.name && (
                        <Link to={provinceHref} className="hover:text-[#8026FA]">{province.name}</Link>
                      )}
                      {province?.name && country && <span>·</span>}
                      {country?.name && (
                        <span>{country.flag_emoji ? `${country.flag_emoji} ` : ''}{country.name}</span>
                      )}
                    </span>
                  )}
                </div>
                {(menLeague || womenLeague) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {menLeague && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        <Trophy className="h-3 w-3" />
                        Men: {menLeague.name}
                      </span>
                    )}
                    {womenLeague && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700">
                        <Trophy className="h-3 w-3" />
                        Women: {womenLeague.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {claimedProfilePath && (
              <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                      Claimed on HOCKIA
                    </p>
                    <p className="mt-0.5 truncate text-sm text-gray-700">
                      {claimedProfile?.full_name || 'View this club’s full profile, opportunities, and members.'}
                    </p>
                  </div>
                  <Link
                    to={claimedProfilePath}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#8026FA] px-4 py-2 text-sm font-medium text-white hover:bg-[#6B20D4]"
                  >
                    View profile
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}

            {!claimedProfilePath && (
              <p className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500">
                This club hasn’t been claimed on HOCKIA yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
