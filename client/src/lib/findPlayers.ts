import { positionLabel } from '@/lib/identity'
import { genderPill } from '@/lib/opportunityCopy'
import { buildPlayerKeyFacts, type LeagueInput, type PassportInput } from '@/lib/keyFacts'
import { fitTarget, type FitState } from '@/lib/clubRecruiting'

/**
 * Find players + Shortlist (Figma 04 Club · D1.9 332:318 / D1.10 332:539;
 * DEV NOTES 332:738 / 332:746). Pure helpers: ranking, filters, the lines on
 * each row and the per-role shortlist name. CLUB-facing only — fit, counts
 * and shortlist state never reach a player surface.
 */

export type FindFilter = 'open' | 'full_match' | 'eu' | 'not_applied'

export const FIND_FILTERS: { id: FindFilter; label: string }[] = [
  { id: 'open', label: 'Open to play' },
  { id: 'full_match', label: 'Full match' },
  { id: 'eu', label: 'EU passport' },
  { id: 'not_applied', label: 'Not applied' },
]

/** A player row as the pool RPC (community_search_members) returns it, plus the extras we join. */
export interface PoolPlayer {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  position: string | null
  secondary_position: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  current_club: string | null
  current_world_club_id: string | null
  playing_category: string | null
  open_to_play: boolean | null
  available_from: string | null
  last_active_at: string | null
  full_game_video_count: number | null
  career_entry_count: number | null
}

export interface ScoutRow extends PoolPlayer {
  fitState: FitState | null
  fitScore: number | null
  /** Highlights the profile shows: uploaded + the legacy highlight link (playerMediaCounts). */
  highlights: number
  /** Full matches the profile shows: linked + uploaded (playerMediaCounts). Falls back
   *  to full_game_video_count (linked only) when not enriched. */
  fullMatches?: number
  age: number | null
  league: LeagueInput | null
  availabilityDuration: string | null
  /** Application to the active role (not withdrawn), if any. */
  applicationId: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Full matches the profile shows (linked + uploaded), same count as the profile. */
export function rowFullMatches(r: Pick<ScoutRow, 'full_game_video_count'> & { fullMatches?: number }): number {
  return typeof r.fullMatches === 'number' ? r.fullMatches : r.full_game_video_count ?? 0
}

function daysAgo(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

/** "Active today" / "Active yesterday" / "Active 12 days ago". */
export function activeLine(lastActiveAt: string | null | undefined, now = new Date()): string | null {
  const d = daysAgo(lastActiveAt, now)
  if (d === null) return null
  if (d === 0) return 'Active today'
  if (d === 1) return 'Active yesterday'
  return `Active ${d} days ago`
}

/**
 * Evidence line (DEV NOTE 332:742): only non-zero counts — "2 full matches",
 * "6 highlights · 7 career", "1 career entry"; with none, "Active N days ago".
 */
export function evidenceLine(e: { fullMatches: number; highlights: number; career: number; lastActiveAt: string | null }, now = new Date()): { kind: 'video' | 'career' | 'active'; text: string } | null {
  const parts: string[] = []
  if (e.fullMatches > 0) parts.push(e.fullMatches === 1 ? '1 full match' : `${e.fullMatches} full matches`)
  if (e.highlights > 0) parts.push(e.highlights === 1 ? '1 highlight' : `${e.highlights} highlights`)
  if (e.career > 0) {
    parts.push(parts.length === 0 ? (e.career === 1 ? '1 career entry' : `${e.career} career entries`) : `${e.career} career`)
  }
  if (parts.length) return { kind: e.fullMatches > 0 || e.highlights > 0 ? 'video' : 'career', text: parts.join(' · ') }
  const active = activeLine(e.lastActiveAt, now)
  return active ? { kind: 'active', text: active } : null
}

/**
 * Order (DEV NOTE 332:741): fit score first, then evidence — full matches,
 * highlights, career entries — then most recently active. `byFit: false`
 * (no context, or the club's league has no level) ranks by evidence only.
 */
export function rankScoutRows<T extends Pick<ScoutRow, 'fitScore' | 'full_game_video_count' | 'fullMatches' | 'highlights' | 'career_entry_count' | 'last_active_at'>>(rows: T[], opts: { byFit: boolean }): T[] {
  const n = (v: number | null | undefined) => (typeof v === 'number' ? v : 0)
  return [...rows].sort((a, b) => {
    if (opts.byFit) {
      const fa = a.fitScore ?? -1
      const fb = b.fitScore ?? -1
      if (fa !== fb) return fb - fa
    }
    const diffs = [
      rowFullMatches(b) - rowFullMatches(a),
      b.highlights - a.highlights,
      n(b.career_entry_count) - n(a.career_entry_count),
    ]
    for (const d of diffs) if (d !== 0) return d
    return (b.last_active_at ?? '').localeCompare(a.last_active_at ?? '')
  })
}

/** EU passport filter (DEV NOTE 332:743): EITHER nationality is in the EU list. Unknown nationality does not pass. */
export function holdsEuPassport(n1: number | null | undefined, n2: number | null | undefined, euIds: Set<number>): boolean {
  return [n1, n2].some((id) => typeof id === 'number' && euIds.has(id))
}

export function applyFindFilters<T extends Pick<ScoutRow, 'open_to_play' | 'full_game_video_count' | 'fullMatches' | 'nationality_country_id' | 'nationality2_country_id' | 'applicationId'>>(rows: T[], active: Set<FindFilter>, euIds: Set<number>): T[] {
  return rows.filter((r) => {
    if (active.has('open') && !r.open_to_play) return false
    if (active.has('full_match') && !(rowFullMatches(r) > 0)) return false
    if (active.has('eu') && !holdsEuPassport(r.nationality_country_id, r.nationality2_country_id, euIds)) return false
    if (active.has('not_applied') && r.applicationId) return false
    return true
  })
}

export interface CountryLite { id: number; name: string; common_name?: string | null; flag_emoji?: string | null; code?: string | null }

/** "🇦🇷 🇮🇹 Argentina · Italy" — 1–2 nationalities written out (DEV NOTE 332:742). */
export function nationalityLine(ids: (number | null | undefined)[], countries: CountryLite[]): string | null {
  const list = ids
    .filter((id): id is number => typeof id === 'number')
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => countries.find((c) => c.id === id))
    .filter((c): c is CountryLite => Boolean(c))
    .slice(0, 2)
  if (!list.length) return null
  const flags = list.map((c) => c.flag_emoji).filter(Boolean).join(' ')
  const names = list.map((c) => c.common_name || c.name).join(' · ')
  return flags ? `${flags} ${names}` : names
}

/**
 * The 30-second-profile facts (D2 · 395:83) that the row's other lines don't
 * already carry: plays at (+ league, "self-reported" when typed), age,
 * EU passport yes/no and availability. Built with the same key-facts rules
 * as the profile; missing facts are left out of the compact row.
 */
export function rowFactsLine(input: {
  currentClub: string | null
  league: LeagueInput | null
  age: number | null
  passports: PassportInput[]
  openToPlay: boolean | null
  availableFrom: string | null
  availabilityDuration: string | null
}, today = new Date()): string | null {
  const facts = buildPlayerKeyFacts({
    position: null,
    secondaryPosition: null,
    currentClubName: input.currentClub,
    league: input.league,
    availableFrom: input.availableFrom,
    availabilityDuration: input.availabilityDuration,
    passports: input.passports,
    fullMatchCount: 0,
    highlightCount: 0,
    age: input.age,
  }, { viewer: 'recruiter', today })
  const by = (id: string) => facts.find((f) => f.id === id)
  const parts: string[] = []
  const playsAt = by('plays_at')
  if (playsAt && !playsAt.missing) {
    parts.push(playsAt.value)
    if (playsAt.detail && !playsAt.detailMissing && playsAt.detail !== playsAt.value) parts.push(playsAt.detail)
  }
  const age = by('age')
  if (age && !age.missing) parts.push(`Age\u00a0${age.value}`)
  const passport = by('passport')
  if (passport && !passport.missing && passport.detail === 'EU passport') parts.push('EU passport')
  const available = by('available')
  if (input.openToPlay && available && !available.missing) {
    const when = available.detail && !available.detailMissing ? available.detail : available.value
    if (when) parts.push(when === 'Available now' ? when : when.startsWith('From ') ? `Available ${when.charAt(0).toLowerCase()}${when.slice(1)}` : when)
  }
  return parts.length ? parts.join(' · ') : null
}

/** The recruiting context the "Ranked for" pill shows. */
export interface ContextLike {
  id: string
  type: string | null
  label: string | null
  target_category: string | null
  target_position: string | null
  target_role: string | null
  opportunity_id: string | null
}

/** A saved context's name; else "Midfielder · Men's" (position + team); else the label. */
export function contextPillLabel(ctx: ContextLike | null): string {
  if (!ctx) return 'No context'
  // A saved context's own name wins (the form says "Shown in Recruiting
  // for"); unnamed ones — and role contexts — keep "Position · Team".
  const name = ctx.type !== 'opportunity' ? ctx.label?.trim() : null
  if (name) return name
  const pos = ctx.target_position ? positionLabel(ctx.target_position) : null
  const team = genderPill(ctx.target_category)?.label ?? null
  const joined = [pos, team].filter(Boolean).join(' · ')
  return joined || ctx.label?.trim() || 'Custom search'
}

/** Only contexts that rank PLAYERS: open player roles and saved (custom) searches — plus the active saved search. */
export function playerContexts<T extends ContextLike>(rows: T[], openPlayerRoleIds: Set<string>, activeId: string | null = null): T[] {
  return rows.filter((r) => {
    // A role context is listed only while its role is OPEN — even the active
    // one (a closed role never stays ticked under "Your open roles").
    if (r.type === 'opportunity' && !(r.opportunity_id && openPlayerRoleIds.has(r.opportunity_id))) return false
    if (r.id === activeId) return true
    if (r.target_role && r.target_role !== 'player') return false
    return true
  })
}

/** compute_club_fit needs an exact "Men" / "Women" / "Mixed" target; anything else → no fit. */
export function contextFitTarget(ctx: ContextLike | null): 'Men' | 'Women' | 'Mixed' | null {
  if (!ctx || (ctx.target_role && ctx.target_role !== 'player')) return null
  return fitTarget(ctx.target_category)
}

/**
 * Shortlist per role (founder ruling 2026-09-25 #9): the club's list named
 * after the role (same rule as the profile's club view), else the default
 * "Saved players" list when no role is active.
 */
export function shortlistForContext<L extends { id: string; name: string; is_default: boolean | null }>(lists: L[], roleTitle: string | null): L | null {
  if (roleTitle) {
    const want = roleTitle.trim().toLowerCase()
    return lists.find((l) => l.name.trim().toLowerCase() === want) ?? null
  }
  return lists.find((l) => l.is_default) ?? null
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

/** Source line (DEV NOTE 332:749): applicants win when a player is both. */
export function shortlistSourceLine(e: { applied: boolean; position: string | null; shortlistedAt: string | null; savedAt: string | null }): string {
  if (e.applied) {
    const pos = e.position ? positionLabel(e.position) : null
    const when = monthDay(e.shortlistedAt)
    return [pos ? `Applied to ${pos}` : 'Applied', when ? `shortlisted ${when}` : 'shortlisted'].join(' · ')
  }
  const when = monthDay(e.savedAt)
  return when ? `Scouted · saved ${when}` : 'Scouted'
}

/** Header line under "Shortlist". */
export function shortlistHeaderLine(count: number): string {
  return `${count === 1 ? '1 player' : `${count} players`} · only your club sees this`
}

/**
 * Club-facing lists show players only when they are 18+ with a known date of
 * birth (founder ruling 2026-09-26); other roles (coaches, clubs…) are not
 * age-checked. `ages` = get_profile_ages rows (no date of birth → no row).
 */
export function keepAdultPlayers<T extends { id: string; role: string | null }>(members: T[], ages: { profile_id: string; age: number | null }[]): T[] {
  const ageById = new Map(ages.map((a) => [a.profile_id, a.age]))
  return members.filter((m) => {
    if (m.role !== 'player') return true
    const age = ageById.get(m.id)
    return typeof age === 'number' && age >= 18
  })
}
