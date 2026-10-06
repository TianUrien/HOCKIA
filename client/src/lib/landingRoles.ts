import { supabase } from '@/lib/supabase'
import { positionLabel } from '@/lib/identity'
import { dayFirst } from '@/lib/dayFirst'

/**
 * "Open roles" on the web landing (Figma "Landing v3" 122:1885): the NEWEST
 * three open roles as full cards, plus the crests of the clubs recruiting.
 *
 * The data is the `public_opportunities` view read through the
 * `public-opportunities` edge function (the public API, service role), not a
 * browser select: the view is `security_invoker` and joins `profiles`
 * columns that anon cannot read, so a direct anon select fails with
 * "permission denied for table profiles". The function applies the view's
 * test-account and hidden-publisher fences and orders `created_at desc, id
 * desc` — strictly creation order (founder ruling 2026-08-13: never
 * `published_at`, which the re-open trigger re-stamps so renewals would jump
 * the queue). Every field used here is one the public API already returns;
 * nothing new is exposed. Compensation ("Paid") is not in the view, so the
 * card never shows it.
 *
 * Flags come from the `countries` table (anon-readable since 202601211000),
 * matched on the role's country name. A missing match simply drops the flag.
 */

export interface OpenRoleCard {
  id: string
  /** Club display name (the API's "Unknown Club" placeholder is dropped). */
  clubName: string | null
  /** True when a club account published the role (the crest strip shows only
   *  real club crests, never a person's photo). */
  clubAccount: boolean
  /** Club avatar — many uploads carry a baked-in white square, so the card
   *  draws it with `mix-blend-mode: multiply` over white. */
  crestUrl: string | null
  city: string | null
  country: string | null
  /** Flag emoji for `country`, resolved after the fetch; null when unknown. */
  flag: string | null
  league: string | null
  /** "Forward" — the position label, else the role's own title. */
  position: string
  /** "Women's" / "Men's" / "Girls'" / "Boys'" / "Mixed"; null when unset. */
  team: string | null
  /** "Starts 16 Sep · 3 months" / "Starts immediately · Full season". */
  when: string | null
  /** Package chips, in the order the club listed them. */
  packages: string[]
  createdAt: string
}

export interface ClubCrest {
  name: string
  url: string
}

/** The slice of the public API's opportunity object that the card uses. */
export type PublicOpportunity = {
  id?: string | null
  title?: string | null
  position?: string | null
  gender?: string | null
  start_date?: string | null
  duration?: string | null
  benefits?: (string | null)[] | null
  created_at?: string | null
  location?: { city?: string | null; country?: string | null } | null
  club?: { name?: string | null; logo_url?: string | null; league?: string | null; kind?: 'club' | 'coach' | null } | null
}

/** The API substitutes this when the publisher has no name. Not a club. */
const UNKNOWN_CLUB = 'Unknown Club'

/**
 * Card title = the role's own title when the club typed one, else
 * "<Position> wanted". A title that is just the bare position label (the
 * post-role default when nothing was typed) counts as not typed.
 */
export function openRoleTitle(row: Pick<PublicOpportunity, 'title' | 'position'>): string {
  const typed = row.title?.trim() ?? ''
  const pos = positionLabel(row.position)
  if (typed && typed.toLowerCase() !== pos?.toLowerCase()) return typed
  if (pos) return `${pos} wanted`
  return typed || 'Open role'
}

/** opportunity_gender → the card's team tag. */
export function teamTag(gender: string | null | undefined): string | null {
  switch (gender) {
    case 'Women': return "Women's"
    case 'Men': return "Men's"
    case 'Girls': return "Girls'"
    case 'Boys': return "Boys'"
    case 'Mixed': return 'Mixed'
    default: return null
  }
}

/** Bare integers from the old form meant months (lib/opportunityCopy rule). */
function durationText(raw: string | null | undefined): string | null {
  const t = raw?.trim().replace(/\s+/g, ' ') ?? ''
  if (!t) return null
  if (/^\d+$/.test(t)) return t === '1' ? '1 month' : `${t} months`
  return t
}

/** "Starts 16 Sep · 3 months" — day first, app-wide (lib/dayFirst). */
export function whenLine(row: Pick<PublicOpportunity, 'start_date' | 'duration'>, now = new Date()): string | null {
  const start = dayFirst(row.start_date, { now })
  const duration = durationText(row.duration)
  if (!start && !duration) return null
  const starts = start ? `Starts ${start}` : 'Starts immediately'
  return duration ? `${starts} · ${duration}` : starts
}

/** Package keys the post-role form writes → chip labels. Custom benefits
 *  (free text the club typed) are shown as written. */
const PACKAGE_LABELS: Record<string, string> = {
  paid: 'Paid', housing: 'Housing', flights: 'Flights', job: 'Job', insurance: 'Insurance',
  bonuses: 'Bonuses', visa: 'Visa', car: 'Car', equipment: 'Equipment', meals: 'Meals', education: 'Education',
}

export function packageLabel(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? ''
  if (!t) return null
  return PACKAGE_LABELS[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Posted-ago, the short form the card has room for: "now", "4m", "2h", "3d",
 * "3w", "2mo". Never "ago" (the app's activity-age rule).
 */
export function postedAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 35) return `${Math.floor(days / 7)}w`
  return `${Math.max(1, Math.floor(days / 30))}mo`
}

export function toOpenRoleCard(row: PublicOpportunity, now = new Date()): OpenRoleCard | null {
  if (!row.id) return null
  const club = row.club?.name?.trim() ?? ''
  const clubName = club && club !== UNKNOWN_CLUB ? club : null
  const packages = (row.benefits ?? []).flatMap((b) => {
    const label = packageLabel(b)
    return label ? [label] : []
  })
  return {
    id: row.id,
    clubName,
    clubAccount: row.club?.kind === 'club',
    crestUrl: row.club?.logo_url?.trim() || null,
    city: row.location?.city?.trim() || null,
    country: row.location?.country?.trim() || null,
    flag: null,
    league: row.club?.league?.trim() || null,
    position: positionLabel(row.position) ?? openRoleTitle(row),
    team: teamTag(row.gender),
    when: whenLine(row, now),
    packages: Array.from(new Set(packages)),
    createdAt: row.created_at ?? '',
  }
}

/** "Bologna, Italy · Serie A1" — the card's place line, omitting what is missing (flag drawn separately). */
export function placeLine(card: Pick<OpenRoleCard, 'city' | 'country' | 'league'>): string {
  const place = [card.city, card.country].filter(Boolean).join(', ')
  return [place, card.league].filter(Boolean).join(' · ')
}

/** The strip shows nothing rather than a thin row. */
export const MIN_CREST_STRIP = 3

/**
 * Unique club accounts (first appearance wins) that have a crest, for the
 * strip: never a coach's photo and never an initials fallback. Fewer than
 * MIN_CREST_STRIP qualifying clubs → an empty strip (hidden).
 */
export function clubCrests(cards: OpenRoleCard[], max = 8): ClubCrest[] {
  const seen = new Set<string>()
  const out: ClubCrest[] = []
  for (const c of cards) {
    if (!c.clubAccount || !c.clubName || !c.crestUrl) continue
    const key = c.clubName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: c.clubName, url: c.crestUrl })
    if (out.length >= max) break
  }
  return out.length >= MIN_CREST_STRIP ? out : []
}

/** Up to two letters for the crest-less tile: "Hockey Team Bologna" → "HB". */
export function clubInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  if (words.length === 0) return ''
  const first = words[0][0]
  const second = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + second).toUpperCase()
}

/** Cards shown. */
export const OPEN_ROLES_LIMIT = 3
/** Rows read: the extra rows only feed the crest strip. */
export const OPEN_ROLES_FETCH_LIMIT = 12

type CountryFlagRow = { name: string; common_name: string | null; flag_emoji: string | null }
let flagRows: CountryFlagRow[] | null = null

/** Country name (or common name) → flag emoji, from the public countries table. */
export async function fetchCountryFlags(): Promise<CountryFlagRow[]> {
  if (flagRows) return flagRows
  const { data, error } = await supabase.from('countries').select('name, common_name, flag_emoji')
  if (error) throw error
  flagRows = (data ?? []) as CountryFlagRow[]
  return flagRows
}

export function flagFor(rows: ReadonlyArray<CountryFlagRow>, name: string | null): string | null {
  const key = name?.trim().toLowerCase()
  if (!key) return null
  const hit = rows.find((c) => c.name.toLowerCase() === key || c.common_name?.toLowerCase() === key)
  return hit?.flag_emoji ?? null
}

export interface LandingRoles {
  roles: OpenRoleCard[]
  crests: ClubCrest[]
}

export async function fetchLandingRoles(now = new Date()): Promise<LandingRoles> {
  const { data, error } = await supabase.functions.invoke<{ data?: PublicOpportunity[] }>(
    `public-opportunities?limit=${OPEN_ROLES_FETCH_LIMIT}`,
    { method: 'GET' },
  )
  if (error) throw error
  const cards = (data?.data ?? []).flatMap((row) => {
    const card = toOpenRoleCard(row, now)
    return card ? [card] : []
  })
  if (cards.length === 0) return { roles: [], crests: [] }

  // Flags are decoration: a failed lookup must not cost the section.
  let flags: CountryFlagRow[] = []
  try {
    flags = await fetchCountryFlags()
  } catch {
    flags = []
  }
  const roles = cards.slice(0, OPEN_ROLES_LIMIT).map((c) => ({ ...c, flag: flagFor(flags, c.country) }))
  return { roles, crests: clubCrests(cards) }
}
