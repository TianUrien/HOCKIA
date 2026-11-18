import { positionLabel } from '@/lib/identity'
import { intlLocale } from '@/i18n/format'
import { tHockiaAi } from '@/i18n/ns/hockiaAi'

/**
 * D5 · Hockia suggests — the reason lines on a suggestion card (Figma
 * "New-Hockia" D5.1 398:83, List item / Reason). Founder ruling 2026-10-04:
 * reasons are TEMPLATES filled from profile fields, never AI text. The facts
 * come from role_suggestions.evidence (compute_role_suggestions, migration
 * 20261004100000), which carries no private field (no date of birth, email
 * or phone).
 *
 * Rules carried here:
 *   - at most 4 lines: the met facts first (most relevant first), then the
 *     single most decision-relevant missing fact (e.g. the passport when the
 *     role requires an EU passport);
 *   - met = green check, missing = grey dash; NEVER amber (nothing here asks
 *     the club to act);
 *   - gender-neutral copy; club-only surface (players never see it).
 */

export interface SuggestionEvidence {
  position_match: 'primary' | 'secondary' | null
  position: string | null
  secondary_position: string | null
  playing_category: string | null
  eu_passport: boolean
  /** ISO date (YYYY-MM-DD) or null. */
  available_from: string | null
  full_matches: number
  highlights: number
  league_name: string | null
  league_self_reported: boolean
  active_30d: boolean
  career_entries: number
  references: number
}

export interface SuggestionRoleContext {
  position: string | null
  gender: string | null
  eu_passport_required: boolean
  start_date: string | null
}

export type ReasonKind = 'met' | 'missing'
export interface ReasonLine {
  kind: ReasonKind
  text: string
  /** Stable key for tests and React lists. */
  key: string
}

export const MAX_REASON_LINES = 4

/** "Women’s player" and the like, per playing category token. */
const CATEGORY_KEYS: Record<string, `reasons.category.${'adult_women' | 'adult_men' | 'girls' | 'boys' | 'mixed'}`> = {
  adult_women: 'reasons.category.adult_women',
  adult_men: 'reasons.category.adult_men',
  girls: 'reasons.category.girls',
  boys: 'reasons.category.boys',
  mixed: 'reasons.category.mixed',
}

/** "January 2027" from a date-only ISO string, without time-zone drift. */
export function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), month - 1, 1)))
}

function isPastOrToday(iso: string, now: Date): boolean {
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  return iso.slice(0, 10) <= today
}

const lower = (s: string | null) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** Normalise an evidence blob from the RPC (missing keys → honest absence). */
export function toEvidence(raw: unknown): SuggestionEvidence {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const pm = e.position_match
  return {
    position_match: pm === 'primary' || pm === 'secondary' ? pm : null,
    position: str(e.position),
    secondary_position: str(e.secondary_position),
    playing_category: str(e.playing_category),
    eu_passport: e.eu_passport === true,
    available_from: str(e.available_from),
    full_matches: num(e.full_matches),
    highlights: num(e.highlights),
    league_name: str(e.league_name),
    league_self_reported: e.league_self_reported === true,
    active_30d: e.active_30d === true,
    career_entries: num(e.career_entries),
    references: num(e.references),
  }
}

/**
 * Every reason the facts support, each with a relevance weight. Higher weight
 * = more decision-relevant for this role. Pure; exported for tests.
 */
export function reasonCandidates(ev: SuggestionEvidence, role: SuggestionRoleContext, now = new Date()): { met: (ReasonLine & { weight: number })[]; missing: (ReasonLine & { weight: number })[] } {
  const met: (ReasonLine & { weight: number })[] = []
  const missing: (ReasonLine & { weight: number })[] = []
  const rolePosition = positionLabel(role.position)

  if (ev.position_match === 'primary' && rolePosition) {
    met.push({ key: 'position', kind: 'met', text: tHockiaAi('reasons.playsPosition', { position: lower(rolePosition) }), weight: 100 })
  } else if (ev.position_match === 'secondary' && rolePosition) {
    met.push({ key: 'position', kind: 'met', text: tHockiaAi('reasons.secondPosition', { position: rolePosition }), weight: 95 })
  }

  if (ev.eu_passport) {
    met.push({ key: 'eu', kind: 'met', text: tHockiaAi('reasons.euPassport'), weight: role.eu_passport_required ? 98 : 60 })
  } else if (role.eu_passport_required) {
    missing.push({ key: 'eu', kind: 'missing', text: tHockiaAi('reasons.noEuPassport'), weight: 100 })
  }

  if (ev.full_matches > 0) {
    met.push({ key: 'full_matches', kind: 'met', text: tHockiaAi('reasons.fullMatches', { count: ev.full_matches }), weight: 90 })
  } else {
    missing.push({ key: 'full_matches', kind: 'missing', text: tHockiaAi('reasons.noFullMatch'), weight: 70 })
  }

  if (ev.league_name) {
    met.push({ key: 'league', kind: 'met', text: ev.league_self_reported ? tHockiaAi('reasons.playsInSelf', { league: ev.league_name }) : tHockiaAi('reasons.playsIn', { league: ev.league_name }), weight: 85 })
  }

  if (ev.available_from) {
    const label = isPastOrToday(ev.available_from, now) ? tHockiaAi('reasons.availableNow') : (() => {
      const my = monthYear(ev.available_from)
      return my ? tHockiaAi('reasons.availableFrom', { date: my }) : null
    })()
    if (label) met.push({ key: 'available', kind: 'met', text: label, weight: role.start_date ? 92 : 65 })
  } else if (role.start_date) {
    missing.push({ key: 'available', kind: 'missing', text: tHockiaAi('reasons.noStartDate'), weight: 90 })
  } else {
    missing.push({ key: 'available', kind: 'missing', text: tHockiaAi('reasons.noStartDate'), weight: 40 })
  }

  if (ev.highlights > 0) met.push({ key: 'highlights', kind: 'met', text: tHockiaAi('reasons.highlights'), weight: 80 })
  if (ev.active_30d) met.push({ key: 'active', kind: 'met', text: tHockiaAi('reasons.active'), weight: 70 })
  if (ev.references > 0) met.push({ key: 'references', kind: 'met', text: tHockiaAi('reasons.references', { count: ev.references }), weight: 55 })
  if (ev.career_entries > 0) met.push({ key: 'career', kind: 'met', text: tHockiaAi('reasons.career', { count: ev.career_entries }), weight: 50 })

  const categoryKey = ev.playing_category ? CATEGORY_KEYS[ev.playing_category] : null
  if (categoryKey) met.push({ key: 'category', kind: 'met', text: tHockiaAi(categoryKey), weight: 20 })

  const byWeight = (a: { weight: number }, b: { weight: number }) => b.weight - a.weight
  return { met: met.sort(byWeight), missing: missing.sort(byWeight) }
}

/**
 * The card's reason lines: up to 4, met first, then the one most
 * decision-relevant missing fact (always shown when there is one, so the
 * club sees what the profile can't confirm).
 */
export function suggestionReasons(ev: SuggestionEvidence, role: SuggestionRoleContext, now = new Date()): ReasonLine[] {
  const { met, missing } = reasonCandidates(ev, role, now)
  const topMissing = missing[0] ?? null
  const metSlots = topMissing ? MAX_REASON_LINES - 1 : MAX_REASON_LINES
  const lines: ReasonLine[] = met.slice(0, metSlots).map(({ key, kind, text }) => ({ key, kind, text }))
  if (topMissing) lines.push({ key: topMissing.key, kind: topMissing.kind, text: topMissing.text })
  return lines
}
