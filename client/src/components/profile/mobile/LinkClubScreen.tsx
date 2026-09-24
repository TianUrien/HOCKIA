import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Info, Search, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import CountrySelect from '@/components/CountrySelect'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useCountries } from '@/hooks/useCountries'
import { getImageUrl } from '@/lib/imageUrl'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import type { ClubProfileShape } from '@/pages/ClubDashboard'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

/**
 * Link your club (Figma 04 Club 338:495), list-only v1. Search the world-club
 * directory within a country (default: the club profile's country). An
 * unclaimed match → claim_world_club; claimed by someone else → "Already
 * linked — contact us"; no match → "Add <name>" prefilled from the profile →
 * create_and_claim_world_club. Both set current_world_club_id and the league
 * ids. Leagues are picked from the country's list only; "Can't find your
 * league?" goes to Contact us (founder ruling 2026-09-23: typed suggestions and
 * their review queue come last).
 */
interface LinkClubScreenProps {
  profile: ClubProfileShape
  onCancel: () => void
  onLinked: () => void
}

type Match = {
  id: string
  name: string
  crest: string | null
  countryId: number
  province: string | null
  isClaimed: boolean
  menLeagueId: number | null
  womenLeagueId: number | null
  leagueName: string | null
}
type League = { id: number; name: string; tier: number | null; province: string | null; provinceId: number | null }
type Side = 'men' | 'women'
type Pick = { kind: 'existing'; match: Match } | { kind: 'new' } | null

export default function LinkClubScreen({ profile, onCancel, onLinked }: LinkClubScreenProps) {
  const fetchProfile = useAuthStore((s) => s.fetchProfile)
  const addToast = useToastStore((s) => s.addToast)
  const { countries } = useCountries()
  const [countryId, setCountryId] = useState<number | null>(profile.nationality_country_id ?? null)
  const [query, setQuery] = useState(profile.full_name?.trim() ?? '')
  const [matches, setMatches] = useState<Match[]>([])
  const [searching, setSearching] = useState(false)
  const [leagues, setLeagues] = useState<League[]>([])
  const [pick, setPick] = useState<Pick>(null)
  const [menId, setMenId] = useState<number | null>(null)
  const [womenId, setWomenId] = useState<number | null>(null)
  const [picker, setPicker] = useState<Side | null>(null)
  const [countrySheet, setCountrySheet] = useState(false)
  const [contact, setContact] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const country = useMemo(() => countries.find((c) => c.id === countryId) ?? null, [countries, countryId])
  const countryLabel = country ? [country.flag_emoji, country.common_name || country.name].filter(Boolean).join(' ') : 'Choose a country'
  const countryName = country?.common_name || country?.name || ''
  const q = query.trim()

  // Directory search, within the chosen country.
  useEffect(() => {
    if (q.length < 2 || !countryId) { setMatches([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('search_world_clubs', { p_query: q, p_limit: 40 })
      if (cancelled) return
      if (err) logger.debug('[LinkClubScreen] search failed', err)
      const rows = (data ?? []) as Array<{ id: string; club_name: string; avatar_url: string | null; country_id: number; province_name: string | null; is_claimed: boolean; men_league_id: number | null; women_league_id: number | null; men_league_name: string | null; women_league_name: string | null }>
      setMatches(rows.filter((r) => r.country_id === countryId).slice(0, 8).map((r) => ({
        id: r.id, name: r.club_name, crest: r.avatar_url, countryId: r.country_id, province: r.province_name,
        isClaimed: r.is_claimed, menLeagueId: r.men_league_id, womenLeagueId: r.women_league_id,
        leagueName: r.men_league_name ?? r.women_league_name ?? null,
      })))
      setSearching(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, countryId])

  // The country's leagues (list-only v1).
  useEffect(() => {
    if (!countryId) { setLeagues([]); return }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('world_leagues')
        .select('id, name, tier, province_id, display_order, province:world_provinces(name)')
        .eq('country_id', countryId)
        .order('tier', { ascending: true, nullsFirst: false })
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
      if (cancelled) return
      setLeagues(((data ?? []) as unknown as Array<{ id: number; name: string; tier: number | null; province_id: number | null; province: { name: string } | null }>)
        .map((l) => ({ id: l.id, name: l.name, tier: l.tier, provinceId: l.province_id, province: l.province?.name ?? null })))
    })()
    return () => { cancelled = true }
  }, [countryId])

  // A new search or country clears a pick that no longer applies.
  useEffect(() => { setPick(null); setMenId(null); setWomenId(null); setError(null) }, [countryId])

  const exactMatch = matches.some((m) => m.name.trim().toLowerCase() === q.toLowerCase())
  const showAdd = q.length >= 2 && !searching && !exactMatch && Boolean(countryId)

  const choose = (next: Pick) => {
    setPick(next)
    setError(null)
    if (next?.kind === 'existing') {
      // The directory already knows this club's leagues; start from them.
      setMenId(next.match.menLeagueId)
      setWomenId(next.match.womenLeagueId)
    }
  }

  const leagueLabel = (id: number | null, empty: string) => {
    const l = id === null ? null : leagues.find((x) => x.id === id)
    if (!l) return empty
    return l.province && leagues.filter((x) => x.name === l.name).length > 1 ? `${l.name} · ${l.province}` : l.name
  }

  const submit = async () => {
    if (!pick || !countryId) return
    setSaving(true)
    setError(null)
    try {
      if (pick.kind === 'existing') {
        const { data, error: err } = await supabase.rpc('claim_world_club', {
          p_world_club_id: pick.match.id,
          p_profile_id: profile.id,
          p_men_league_id: menId ?? undefined,
          p_women_league_id: womenId ?? undefined,
        }) as { data: { success: boolean; error?: string } | null; error: Error | null }
        if (err) throw err
        if (data && !data.success) {
          if (/already been claimed/i.test(data.error ?? '')) { setError('already_linked'); return }
          throw new Error(data.error || 'Could not link the club')
        }
      } else {
        const provinceId = leagues.find((l) => l.id === menId)?.provinceId ?? leagues.find((l) => l.id === womenId)?.provinceId ?? null
        const { data, error: err } = await supabase.rpc('create_and_claim_world_club', {
          p_club_name: q,
          p_country_id: countryId,
          p_province_id: provinceId ?? undefined,
          p_profile_id: profile.id,
          p_men_league_id: menId ?? undefined,
          p_women_league_id: womenId ?? undefined,
        }) as { data: { success: boolean; error?: string } | null; error: Error | null }
        if (err) throw err
        if (data && !data.success) throw new Error(data.error || 'Could not add the club')
      }
      await fetchProfile(profile.id, { force: true })
      addToast('Club linked', 'success')
      onLinked()
    } catch (err) {
      logger.error('[LinkClubScreen] link failed', err)
      setError(err instanceof Error ? err.message : 'Could not link the club. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const crestFor = (url: string | null) => (url ? getImageUrl(url, 'avatar-sm') ?? url : null)
  const selected = (id: string | 'new') => (id === 'new' ? pick?.kind === 'new' : pick?.kind === 'existing' && pick.match.id === id)
  const radio = (on: boolean) => (
    <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', on ? 'bg-hockia-primary text-white' : 'border-[1.5px] border-ink-4')}>
      {on && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
    </span>
  )
  const sectionLabel = (text: string) => <p className="px-5 pb-2 pt-[22px] text-caption font-semibold uppercase tracking-[0.04em] text-ink-2">{text}</p>

  return (
    <div className="flex min-h-screen flex-col bg-white lg:hidden" data-testid="link-club-screen">
      <div className="flex h-11 items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onCancel} className="w-[120px] text-left text-body text-hockia-primary">Cancel</button>
        <h1 className="text-body font-semibold text-ink-1">Link your club</h1>
        <span className="w-[120px]" />
      </div>

      <div className="flex-1 overflow-y-auto pb-28">
        <div className="px-5 pb-2 pt-1.5">
          <h2 className="text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-ink-1">Find your club</h2>
          <p className="mt-1 text-[14px] leading-5 text-ink-2">Linking puts your league next to your name and lets fit compare levels.</p>
        </div>

        <div className="px-5 pt-2.5">
          <label className="flex h-11 items-center gap-2 rounded-xl bg-surface-grouped pl-3 pr-2.5">
            <Search className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPick(null) }}
              placeholder="Club name"
              aria-label="Club name"
              className="min-w-0 flex-1 bg-transparent text-body text-ink-1 outline-none placeholder:text-ink-4"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); setPick(null) }} aria-label="Clear" className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-4 text-white">
                <X className="h-[11px] w-[11px]" strokeWidth={3} />
              </button>
            )}
          </label>
        </div>

        <div className="flex items-center gap-1.5 px-5 pt-2.5">
          <span className="text-[14px] text-ink-2">In</span>
          <button type="button" onClick={() => setCountrySheet(true)} className="inline-flex items-center gap-1 rounded-full bg-surface-grouped py-1 pl-2.5 pr-2 text-[14px] font-semibold text-ink-1">
            {countryLabel}
            <ChevronDown className="h-3.5 w-3.5 text-ink-3" strokeWidth={2.2} />
          </button>
        </div>

        {q.length >= 2 && countryId && (
          <>
            {matches.length > 0 && sectionLabel(`Clubs in ${countryName}`)}
            {matches.length > 0 && (
              <div className="px-5">
                <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" data-testid="link-club-matches">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={selected(m.id)}
                      onClick={() => (m.isClaimed ? setError('already_linked') : choose({ kind: 'existing', match: m }))}
                      className="flex w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-line bg-white">
                        {crestFor(m.crest) ? <img src={crestFor(m.crest) as string} alt="" className="h-[34px] w-[34px] object-contain" /> : <EntityAvatar src={null} name={m.name} role="club" size={34} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-medium leading-[21px] text-ink-1">{m.name}</span>
                        <span className="block truncate text-secondary text-ink-2">
                          {m.isClaimed ? 'Already linked to another account' : [m.province, m.leagueName].filter(Boolean).join(' · ') || countryName}
                        </span>
                      </span>
                      {m.isClaimed ? <span className="shrink-0 text-caption font-semibold text-ink-3">Linked</span> : radio(selected(m.id))}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showAdd && sectionLabel(matches.length ? 'Not listed?' : `No club called “${q}” in ${countryName} yet`)}
            {showAdd && (
              <div className="px-5">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected('new')}
                  onClick={() => choose({ kind: 'new' })}
                  className="flex w-full items-center gap-3 rounded-card bg-surface-grouped py-3 pl-3.5 pr-3 text-left"
                  data-testid="link-club-add"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-line bg-white">
                    {crestFor(profile.avatar_url ?? null) ? <img src={crestFor(profile.avatar_url ?? null) as string} alt="" className="h-[34px] w-[34px] object-contain" /> : <EntityAvatar src={null} name={q} role="club" size={34} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-medium leading-[21px] text-ink-1">Add {q}</span>
                    <span className="block truncate text-secondary text-ink-2">
                      {[[country?.flag_emoji, (countryId === profile.nationality_country_id ? profile.base_location?.trim() : null) || countryName].filter(Boolean).join(' '), 'from your profile'].join(' · ')}
                    </span>
                  </span>
                  {radio(selected('new'))}
                </button>
              </div>
            )}
          </>
        )}

        {error === 'already_linked' && (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-card bg-surface-grouped px-3.5 py-3 text-secondary leading-[18px] text-ink-2" data-testid="link-club-already-linked">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
            <span>This club is already linked to another account. <button type="button" onClick={() => setContact(true)} className="font-semibold text-hockia-primary">Contact us</button> and we’ll sort it out.</span>
          </div>
        )}

        {pick && (
          <>
            {sectionLabel('Leagues')}
            <div className="px-5">
              <div className="rounded-card bg-surface-grouped">
                {(['men', 'women'] as Side[]).map((side, i) => (
                  <div key={side}>
                    <button type="button" onClick={() => setPicker(side)} disabled={leagues.length === 0} className="flex min-h-[45px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left disabled:opacity-60">
                      <span className="min-w-0 flex-1 text-[16px] leading-[21px] text-ink-1">{side === 'men' ? 'Men’s teams' : 'Women’s teams'}</span>
                      <span className={cn('max-w-[55%] shrink-0 truncate text-[16px] leading-[21px]', (side === 'men' ? menId : womenId) === null ? 'text-ink-4' : 'text-ink-2')}>{leagueLabel(side === 'men' ? menId : womenId, 'Not set')}</span>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />
                    </button>
                    {i === 0 && <div className="ml-4 h-[0.5px] bg-line" />}
                  </div>
                ))}
              </div>
            </div>
            {leagues.length === 0 && (
              <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-card bg-surface-grouped px-3.5 py-3 text-secondary leading-[18px] text-ink-2" data-testid="link-club-no-leagues">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
                <span>Hockia has no leagues for {countryName} yet. Your roles work in the meantime; fit just can’t compare levels until we add yours.</span>
              </div>
            )}
            <div className="px-5 pt-4">
              <button type="button" onClick={() => setContact(true)} className="text-row font-semibold text-hockia-primary">Can’t find your league? Contact us</button>
            </div>
          </>
        )}

        {error && error !== 'already_linked' && <p className="px-5 pt-3 text-secondary text-red-600" role="alert">{error}</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!pick || saving}
          className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Linking…' : pick?.kind === 'new' ? 'Add and link' : 'Link club'}
        </button>
      </div>

      <BottomSheet open={picker !== null} onClose={() => setPicker(null)} ariaLabel={picker === 'women' ? 'Women’s teams league' : 'Men’s teams league'}>
        <div className="px-5 pb-6 pt-2">
          <h2 className="text-[20px] font-bold leading-[25px] text-ink-1">{picker === 'women' ? 'Women’s teams' : 'Men’s teams'}</h2>
          <p className="mt-1 text-secondary text-ink-2">The league of your top {picker === 'women' ? 'women’s' : 'men’s'} team in {countryName}.</p>
          <div className="mt-4 divide-y divide-line rounded-card bg-surface-grouped">
            {[...leagues.map((l) => ({ id: l.id as number | null, label: leagueLabel(l.id, l.name), tier: l.tier })), { id: null, label: 'Not set', tier: null }].map((opt) => {
              const current = picker === 'women' ? womenId : menId
              const on = current === opt.id
              return (
                <button key={opt.id ?? 'none'} type="button" role="radio" aria-checked={on} onClick={() => { if (picker === 'women') setWomenId(opt.id); else setMenId(opt.id); setPicker(null) }} className="flex min-h-[50px] w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={cn('min-w-0 flex-1 text-body', opt.id === null ? 'text-ink-2' : 'text-ink-1')}>{opt.label}</span>
                  {opt.tier !== null && <span className="shrink-0 text-caption text-ink-3">Tier {opt.tier}</span>}
                  {on && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.5} />}
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => { setPicker(null); setContact(true) }} className="mt-4 text-row font-semibold text-hockia-primary">Can’t find your league? Contact us</button>
        </div>
      </BottomSheet>

      <BottomSheet open={countrySheet} onClose={() => setCountrySheet(false)} ariaLabel="Country">
        <div className="px-5 pb-6 pt-2">
          <h2 className="mb-3 text-[20px] font-bold leading-[25px] text-ink-1">Country</h2>
          <CountrySelect value={countryId} onChange={(id) => { setCountryId(id); setCountrySheet(false) }} appearance="field" />
        </div>
      </BottomSheet>

      {contact && <Suspense fallback={null}><FeedbackModal open={contact} onClose={() => setContact(false)} /></Suspense>}
    </div>
  )
}
