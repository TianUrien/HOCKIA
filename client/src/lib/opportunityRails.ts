import type { Vacancy } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import type { Country } from '@/hooks/useCountries'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { closesLabel, deadlineDaysLeft, isPaid } from '@/lib/opportunityCopy'

/**
 * Opportunities v2 list structure (founder ruling 3 + 16 Oct 2026 answers):
 * featured card → themed rails → "All open roles". Pure functions over the
 * already-filtered list, so a filter that excludes the featured role hides
 * it, and a rail with fewer than 2 cards hides itself.
 *
 * Relevance ("Roles for you") = the role would take the viewer's application
 * (same eligibility rules as the apply sheet and the DB trigger) AND, when
 * both sides name a position, the positions match. Guests and coaches fall
 * back to the deadline/newest ladder.
 */

const DAY = 86_400_000
export const NEW_ROLE_DAYS = 7
export const CLOSING_SOON_DAYS = 14

export interface RelevanceContext {
  profile: Profile | null | undefined
  countries: Country[]
}

export function daysUntil(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - now.getTime()) / DAY)
}

export function isNewRole(v: Pick<Vacancy, 'created_at'>, now = new Date()): boolean {
  return now.getTime() - new Date(v.created_at).getTime() <= NEW_ROLE_DAYS * DAY
}

/**
 * Card status (Figma Card / Opportunity): "Closes in N days" when ≤ 14 days,
 * "Closes 30 Nov" with a later deadline, "New" when posted ≤ 7 days ago,
 * otherwise nothing. Closing wins over New: it is the one the player acts on.
 */
export function roleStatus(v: Pick<Vacancy, 'created_at' | 'application_deadline'>, now = new Date()): { label: string; tone: 'brand' | 'ink' | 'amber' } | null {
  // One shared label (lib/opportunityCopy closesLabel, audit A5).
  const days = deadlineDaysLeft(v.application_deadline, now)
  const label = closesLabel(v.application_deadline, now)
  if (days !== null && days >= 0 && label) {
    return { label, tone: days <= 5 ? 'amber' : 'ink' }
  }
  if (isNewRole(v, now)) return { label: 'New', tone: 'brand' }
  return null
}

export function isRelevantForViewer(v: Vacancy, ctx: RelevanceContext): boolean {
  const { profile } = ctx
  if (!profile || (profile.role !== 'player' && profile.role !== 'coach')) return false
  if (profile.role === 'player' && v.opportunity_type !== 'player') return false
  if (profile.role === 'coach' && v.opportunity_type !== 'coach') return false
  if (!checkOpportunityEligibility(v, profile, ctx.countries).eligible) return false
  if (profile.role === 'player' && v.position && profile.position) {
    return v.position.trim().toLowerCase() === profile.position.trim().toLowerCase()
  }
  return true
}

const created = (v: Pick<Vacancy, 'created_at'>) => new Date(v.created_at).getTime()
const newestFirst = (a: Vacancy, b: Vacancy) => created(b) - created(a)
const soonestFirst = (a: Vacancy, b: Vacancy) => {
  const da = a.application_deadline ? new Date(a.application_deadline).getTime() : Infinity
  const db = b.application_deadline ? new Date(b.application_deadline).getTime() : Infinity
  return da !== db ? da - db : newestFirst(a, b)
}

/**
 * Featured = the newest role relevant to the viewer; else the one closing
 * soonest (with a deadline still ahead); else the newest open role.
 */
export function pickFeatured(list: Vacancy[], ctx: RelevanceContext, now = new Date()): Vacancy | null {
  if (list.length === 0) return null
  const relevant = list.filter((v) => isRelevantForViewer(v, ctx)).sort(newestFirst)
  if (relevant[0]) return relevant[0]
  const closing = list.filter((v) => { const d = daysUntil(v.application_deadline, now); return d !== null && d >= 0 }).sort(soonestFirst)
  if (closing[0]) return closing[0]
  return [...list].sort(newestFirst)[0] ?? null
}

export type RailKey = 'for-you' | 'paid-housing' | 'closing-soon'
export interface RoleRail { key: RailKey; title: string; subtitle: string; roles: Vacancy[] }

export const MIN_RAIL_CARDS = 2
const MAX_RAIL_CARDS = 8

/** The rails, in order, excluding the featured role; each hides under 2 cards. */
export function buildRails(list: Vacancy[], ctx: RelevanceContext, featuredId: string | null, now = new Date()): RoleRail[] {
  const pool = featuredId ? list.filter((v) => v.id !== featuredId) : list
  const rails: RoleRail[] = [
    { key: 'for-you', title: 'Opportunities for you', subtitle: 'Match your position, team and passport', roles: pool.filter((v) => isRelevantForViewer(v, ctx)).sort(newestFirst) },
    { key: 'paid-housing', title: 'Paid, with housing', subtitle: 'Contracts that include a place to live', roles: pool.filter((v) => isPaid(v) && (v.benefits ?? []).some((b) => b.toLowerCase() === 'housing')).sort(newestFirst) },
    { key: 'closing-soon', title: 'Closing soon', subtitle: `Apply in the next ${CLOSING_SOON_DAYS} days`, roles: pool.filter((v) => { const d = daysUntil(v.application_deadline, now); return d !== null && d >= 0 && d <= CLOSING_SOON_DAYS }).sort(soonestFirst) },
  ]
  return rails.filter((r) => r.roles.length >= MIN_RAIL_CARDS).map((r) => ({ ...r, roles: r.roles.slice(0, MAX_RAIL_CARDS) }))
}
