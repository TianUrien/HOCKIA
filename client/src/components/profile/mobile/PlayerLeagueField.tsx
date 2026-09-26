import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { leagueSideFor } from '@/lib/profileD2'

/**
 * League half of the player's "Club & league" editor (D2 "Add league").
 *
 * The linked club's league is the verified one — shown read-only when the
 * club has it. When the club has no league on Hockia, the player can pick
 * their own from the club's country (or their base / passport country when no
 * club is linked). That choice is saved to profiles.mens/womens_league_id and
 * shown with a "self-reported" label; it never counts for level or fit
 * (founder ruling 2026-09-26; see player_league()).
 */
type Option = { id: number; name: string }

interface PlayerLeagueFieldProps {
  worldClubId: string | null
  fallbackCountryId: number | null
  playingCategory: string | null
  value: number | null
  onChange: (leagueId: number | null, leagueName: string | null) => void
  /** Reports whether the linked club already carries a league (then `value` is ignored on save). */
  onClubLeague: (clubLeagueName: string | null) => void
}

const input = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30'

export function PlayerLeagueField({ worldClubId, fallbackCountryId, playingCategory, value, onChange, onClubLeague }: PlayerLeagueFieldProps) {
  const [clubLeague, setClubLeague] = useState<string | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const women = leagueSideFor(playingCategory) === 'womens_league_id'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        let countryId = fallbackCountryId
        let clubName: string | null = null
        if (worldClubId) {
          const { data } = await supabase
            .from('world_clubs')
            .select(`country_id,
              men_league:world_leagues!world_clubs_men_league_id_fkey(name),
              women_league:world_leagues!world_clubs_women_league_id_fkey(name)`)
            .eq('id', worldClubId)
            .maybeSingle()
          const row = data as unknown as { country_id: number | null; men_league: { name: string } | null; women_league: { name: string } | null } | null
          if (row) {
            countryId = row.country_id ?? countryId
            clubName = (women ? row.women_league?.name ?? row.men_league?.name : row.men_league?.name ?? row.women_league?.name) ?? null
          }
        }
        if (cancelled) return
        setClubLeague(clubName)
        onClubLeague(clubName)
        if (clubName || !countryId) { setOptions([]); return }
        const { data: leagues } = await supabase
          .from('world_leagues')
          .select('id, name')
          .eq('country_id', countryId)
          .order('tier', { ascending: true, nullsFirst: false })
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true })
        if (!cancelled) setOptions(((leagues ?? []) as Option[]))
      } catch (err) {
        logger.debug('[PlayerLeagueField] load failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // onClubLeague is a setter from the parent; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldClubId, fallbackCountryId, women])

  if (loading) return <div className="h-[50px] animate-pulse rounded-[12px] bg-surface-grouped" />
  if (clubLeague) {
    return (
      <div>
        <span className="mb-1.5 block text-secondary font-semibold text-ink-2">League</span>
        <p className="flex h-[50px] items-center rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1">{clubLeague}</p>
        <p className="mt-1.5 text-caption text-ink-3">From your club on Hockia.</p>
      </div>
    )
  }
  if (options.length === 0) {
    return <p className="text-caption text-ink-3">{worldClubId ? 'Your club has no league on Hockia yet, and there are no leagues for its country to choose from.' : 'Link your club to add your league.'}</p>
  }
  return (
    <div>
      <label htmlFor="edit-own-league" className="mb-1.5 block text-secondary font-semibold text-ink-2">League (optional)</label>
      <select
        id="edit-own-league"
        value={value ?? ''}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : null
          onChange(id, id ? options.find((o) => o.id === id)?.name ?? null : null)
        }}
        className={input}
      >
        <option value="">Not set</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <p className="mt-1.5 text-caption text-ink-3">Your club has no league on Hockia yet, so clubs see this one marked “self-reported”.</p>
    </div>
  )
}
