import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Info } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { getImageUrl } from '@/lib/imageUrl'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import type { Profile } from '@/lib/supabase'
import type { ClubProfileShape } from '@/pages/ClubDashboard'
import { leagueBandNote } from '@/lib/clubProfileCopy'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

/**
 * Club & league (Figma 04 Club 338:424). What players see next to the club's
 * name, and what fit compares a player's level against. Reads the world club
 * the profile claimed (world_clubs) and its country's leagues; a league row
 * opens a picker and the choice is saved at once to the profile's league
 * ids — the DB trigger mirrors them onto world_clubs and the text fields,
 * exactly as the desktop editor does. Not linked yet → Link your club
 * (338:495).
 *
 * DEV NOTE: when a linked league has no level band, say so under Leagues —
 * fit cannot compare levels for the club's roles until Hockia has one.
 * "Can't find your league?" goes to Contact us (founder ruling 2026-09-23:
 * league suggestions come last, with their own review queue).
 */
interface ClubLeagueScreenProps {
  profile: ClubProfileShape
  onBack: () => void
  /** Not linked yet → Link your club (Figma 338:495). */
  onLink: () => void
}

type Side = 'men' | 'women'
type League = { id: number; name: string; tier: number | null; band: number | null; province: string | null }
type WorldClub = { id: string; clubName: string; crestUrl: string | null; claimedAt: string | null; country: { name: string; flag: string | null } | null; countryId: number }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

export default function ClubLeagueScreen({ profile, onBack, onLink }: ClubLeagueScreenProps) {
  const setProfile = useAuthStore((s) => s.setProfile)
  const authProfile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const worldClubId = profile.current_world_club_id ?? null
  const [club, setClub] = useState<WorldClub | null>(null)
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(Boolean(worldClubId))
  const [menId, setMenId] = useState<number | null>(profile.mens_league_id ?? null)
  const [womenId, setWomenId] = useState<number | null>(profile.womens_league_id ?? null)
  const [picker, setPicker] = useState<Side | null>(null)
  const [saving, setSaving] = useState(false)
  const [contact, setContact] = useState(false)

  useEffect(() => {
    if (!worldClubId) { setLoading(false); return }
    let cancelled = false
    void (async () => {
      try {
        const { data: wc, error } = await supabase
          .from('world_clubs')
          .select('id, club_name, avatar_url, claimed_at, country_id, country:countries(name, flag_emoji)')
          .eq('id', worldClubId)
          .maybeSingle()
        if (error) throw error
        if (!wc || cancelled) return
        const row = wc as unknown as { id: string; club_name: string; avatar_url: string | null; claimed_at: string | null; country_id: number; country: { name: string; flag_emoji: string | null } | null }
        setClub({ id: row.id, clubName: row.club_name, crestUrl: row.avatar_url, claimedAt: row.claimed_at, countryId: row.country_id, country: row.country ? { name: row.country.name, flag: row.country.flag_emoji } : null })
        // Only the linked club's country (founder ruling 2026-09-24). A saved
        // league from elsewhere still shows by its stored name on the row,
        // but the picker offers the country's leagues only.
        const { data: rows, error: lErr } = await supabase
          .from('world_leagues')
          .select('id, name, tier, level_band_global, country_id, display_order, province:world_provinces(name)')
          .eq('country_id', row.country_id)
          .order('tier', { ascending: true, nullsFirst: false })
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true })
        if (lErr) throw lErr
        if (cancelled) return
        setLeagues(((rows ?? []) as unknown as Array<{ id: number; name: string; tier: number | null; level_band_global: number | null; province: { name: string } | null }>).map((l) => ({ id: l.id, name: l.name, tier: l.tier, band: l.level_band_global, province: l.province?.name ?? null })))
      } catch (err) {
        logger.debug('[ClubLeagueScreen] load failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [worldClubId])

  const byId = (id: number | null) => (id === null ? null : leagues.find((l) => l.id === id) ?? null)
  const men = byId(menId)
  const women = byId(womenId)
  const note = useMemo(() => leagueBandNote([men, women].filter((l): l is League => Boolean(l))), [men, women])

  const choose = async (side: Side, id: number | null) => {
    const nextMen = side === 'men' ? id : menId
    const nextWomen = side === 'women' ? id : womenId
    setPicker(null)
    if ((side === 'men' ? menId : womenId) === id) return
    setSaving(true)
    const prevMen = menId, prevWomen = womenId
    setMenId(nextMen); setWomenId(nextWomen)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          mens_league_id: nextMen,
          womens_league_id: nextWomen,
          mens_league_division: byId(nextMen)?.name ?? null,
          womens_league_division: byId(nextWomen)?.name ?? null,
        })
        .eq('id', profile.id)
      if (error) throw error
      if (authProfile && authProfile.id === profile.id) {
        setProfile({ ...authProfile, mens_league_id: nextMen, womens_league_id: nextWomen, mens_league_division: byId(nextMen)?.name ?? null, womens_league_division: byId(nextWomen)?.name ?? null } as Profile)
      }
      addToast('League updated', 'success')
    } catch (err) {
      logger.error('[ClubLeagueScreen] save failed', err)
      setMenId(prevMen); setWomenId(prevWomen)
      addToast('Could not save the league. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const crest = club?.crestUrl ?? profile.avatar_url ?? null
  const crestSrc = crest ? getImageUrl(crest, 'avatar-sm') ?? crest : null
  const linkedLine = club ? [[club.country?.flag, club.country?.name].filter(Boolean).join(' ') || null, club.claimedAt ? `linked ${monthDay(club.claimedAt)}` : null].filter(Boolean).join(' · ') : null

  const storedName = (side: Side) => (side === 'men' ? profile.mens_league_division : profile.womens_league_division)?.trim() || null
  // Same-named leagues carry their province on the row too ("Premier League · Victoria").
  const rowLabel = (side: Side, league: League | null) => {
    if (league) return league.province && leagues.filter((l) => l.name === league.name).length > 1 ? `${league.name} · ${league.province}` : league.name
    return ((side === 'men' ? menId : womenId) !== null ? storedName(side) : null) ?? 'Not set'
  }
  const leagueRow = (side: Side, label: string, league: League | null, last: boolean) => (
    <div key={side}>
      <button type="button" onClick={() => setPicker(side)} disabled={saving || !club} className="flex min-h-[45px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left disabled:opacity-60">
        <span className="min-w-0 flex-1 text-[16px] leading-[21px] text-ink-1">{label}</span>
        <span className="max-w-[55%] shrink-0 truncate text-[16px] leading-[21px] text-ink-2">{rowLabel(side, league)}</span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />
      </button>
      {!last && <div className="ml-4 h-[0.5px] bg-line" />}
    </div>
  )

  return (
    <div className="min-h-screen bg-white lg:hidden" data-testid="club-league-screen">
      <DetailNavBar parent="Profile" onBack={onBack} trailing={<button type="button" onClick={onBack} className="text-body font-semibold text-hockia-primary">Done</button>} />
      <div className="px-5 pb-2 pt-1.5">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-ink-1">Club &amp; league</h1>
        <p className="mt-1 text-[14px] leading-5 text-ink-2">What players see next to your name, and what fit compares a player’s level against.</p>
      </div>

      <p className="px-5 pb-2 pt-[22px] text-caption font-semibold uppercase tracking-[0.04em] text-ink-2">Your club on Hockia</p>
      <div className="px-5">
        {worldClubId ? (
          <div className="flex items-center gap-3 rounded-card bg-surface-grouped py-3 pl-3.5 pr-3" data-testid="club-league-linked">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-line bg-white">
              {crestSrc ? <img src={crestSrc} alt="" className="h-[34px] w-[34px] object-contain" /> : <EntityAvatar src={null} name={club?.clubName ?? profile.full_name} role="club" size={34} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium leading-[21px] text-ink-1">{club?.clubName ?? profile.full_name}</span>
              {linkedLine && <span className="block truncate text-secondary text-ink-2">{linkedLine}</span>}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive-soft px-2.5 py-1 text-caption font-semibold text-[#1b8a3f]">
              <Check className="h-3 w-3" strokeWidth={3} /> Linked
            </span>
          </div>
        ) : (
          <div data-testid="club-league-unlinked">
            <div className="rounded-card bg-surface-grouped px-3.5 py-3">
              <p className="text-[16px] font-medium leading-[21px] text-ink-1">Not linked yet</p>
              <p className="text-secondary text-ink-2">Link your club so players see your league and fit can compare levels.</p>
            </div>
            <button type="button" onClick={onLink} className="mt-3 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white" data-testid="club-league-link-cta">
              Link your club
            </button>
          </div>
        )}
      </div>

      {worldClubId && (
        <>
          <p className="px-5 pb-2 pt-[22px] text-caption font-semibold uppercase tracking-[0.04em] text-ink-2">Leagues</p>
          <div className="px-5">
            <div className="rounded-card bg-surface-grouped">
              {leagueRow('men', 'Men’s teams', men, false)}
              {leagueRow('women', 'Women’s teams', women, true)}
            </div>
          </div>
          <p className="px-9 pt-2 text-caption leading-4 text-ink-3">The league of your top team in each. It shows on your roles and profile.</p>
          {note && !loading && (
            <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-card bg-surface-grouped px-3.5 py-3 text-secondary leading-[18px] text-ink-2" data-testid="club-league-band-note">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
              <span>{note}</span>
            </div>
          )}
        </>
      )}

      {worldClubId && (
        <div className="px-5 pb-6 pt-4">
          <button type="button" onClick={() => setContact(true)} className="text-row font-semibold text-hockia-primary">Can’t find your league? Contact us</button>
        </div>
      )}

      <BottomSheet open={picker !== null} onClose={() => setPicker(null)} ariaLabel={picker === 'women' ? 'Women’s teams league' : 'Men’s teams league'}>
        <div className="px-5 pb-6 pt-2">
          <h2 className="text-[20px] font-bold leading-[25px] text-ink-1">{picker === 'women' ? 'Women’s teams' : 'Men’s teams'}</h2>
          <p className="mt-1 text-secondary text-ink-2">The league of your top {picker === 'women' ? 'women’s' : 'men’s'} team{club?.country ? ` in ${club.country.name}` : ''}.</p>
          <div className="mt-4 divide-y divide-line rounded-card bg-surface-grouped">
            {[...leagues.map((l) => ({ id: l.id as number | null, name: l.name, tier: l.tier, province: l.province })), { id: null, name: 'Not set', tier: null, province: null }].map((opt) => {
              // Two leagues can share a name across provinces ("Premier League"
              // in Western Australia and Victoria) — the province tells them apart.
              const repeated = opt.id !== null && leagues.filter((l) => l.name === opt.name).length > 1
              const current = picker === 'women' ? womenId : menId
              const selected = current === opt.id
              return (
                <button key={opt.id ?? 'none'} type="button" role="radio" aria-checked={selected} onClick={() => void choose(picker ?? 'men', opt.id)} className="flex min-h-[50px] w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={cn('min-w-0 flex-1 text-body', opt.id === null ? 'text-ink-2' : 'text-ink-1')}>
                    {opt.name}
                    {repeated && opt.province && <span className="text-ink-3"> · {opt.province}</span>}
                  </span>
                  {opt.tier !== null && <span className="shrink-0 text-caption text-ink-3">Tier {opt.tier}</span>}
                  {selected && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.5} />}
                </button>
              )
            })}
          </div>
        </div>
      </BottomSheet>

      {contact && <Suspense fallback={null}><FeedbackModal open={contact} onClose={() => setContact(false)} /></Suspense>}
    </div>
  )
}
