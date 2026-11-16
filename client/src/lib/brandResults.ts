import { supabase } from '@/lib/supabase'
import { tBrands } from '@/i18n/ns/brands'
import { brandCount } from '@/lib/brandOffers'

/**
 * Brand Results (Figma 08 · Brands P3 / R1; built 2026-11-07). One read,
 * get_my_brand_results, behind the Results screen and the brand Home summary.
 * Breakdown and market numbers are null under 5 members ("Fewer than 5").
 */
export interface ResultsFunnel { shown: number; opened: number; store_visits: number; code_copies: number; contacted: number; not_useful: number }
export interface OfferResult extends ResultsFunnel { id: string; title: string; status: string; image_url: string | null; live_at: string | null }
export interface ResultsContact { profile_id: string; full_name: string | null; avatar_url: string | null; role: string; offer_title: string | null; at: string; conversation_id: string | null }
export interface BrandResults {
  days: number
  totals: ResultsFunnel
  previous: { shown: number; contacted: number; store_visits: number }
  offers: OfferResult[]
  by_country: { country_id: number; n: number }[]
  by_role: { role: string; n: number }[]
  by_surface: { surface: string; n: number }[]
  seen_total: number
  contacts: ResultsContact[]
  waiting: { count: number; oldest_at: string | null }
  market: { country_id: number; n: number | null; covered: boolean }[]
  market_total: number | null
  products: { id: string; name: string; seen: number; store_taps: number }[]
  community: { ambassadors: number; invites_sent: number; invites_accepted: number; new_followers: number }
}

export const RESULT_PERIODS = [7, 30, 90] as const
export type ResultPeriod = (typeof RESULT_PERIODS)[number]

export async function fetchBrandResults(days: ResultPeriod): Promise<BrandResults> {
  const { data, error } = await supabase.rpc('get_my_brand_results', { p_days: days })
  if (error) throw error
  return data as unknown as BrandResults
}

/** "4 more than before" / "2 fewer than before" / "Same as before" / null when both are 0. */
export function changeLine(now: number, before: number): string | null {
  if (now === 0 && before === 0) return null
  if (now === before) return tBrands('results.change.same')
  const d = Math.abs(now - before)
  return now > before ? tBrands('results.change.more', { count: d, n: brandCount(d) }) : tBrands('results.change.fewer', { count: d, n: brandCount(d) })
}

/** "2 days ago", "today" — the oldest message waiting for a reply. */
export function agoLine(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return tBrands('results.ago.today')
  if (days === 1) return tBrands('results.ago.yesterday')
  return tBrands('results.ago.days', { count: days })
}

const SURFACE_KEY: Record<string, 'home' | 'hockiaAi' | 'brandsTab' | 'sharedLink' | 'other'> = {
  home: 'home', home_rail: 'home', hockia_ai: 'hockiaAi', marketplace: 'brandsTab', brands_tab: 'brandsTab',
  need_page: 'brandsTab', offer_detail: 'sharedLink', moment_sheet: 'home', other: 'other',
}
export const surfaceLabel = (s: string) => tBrands(`results.surface.${SURFACE_KEY[s] ?? 'other'}`)
type ResultRole = 'player' | 'coach' | 'club' | 'umpire'
const ROLE_KEYS = new Set<string>(['player', 'coach', 'club', 'umpire'])
/** "Players" for a role token (the table's plural heading). */
export const roleLabel = (r: string) => (ROLE_KEYS.has(r) ? tBrands(`results.roles.${r as ResultRole}`) : r)
/** "Player" for a role token (one person's row). */
export const roleLabelOne = (r: string) => (ROLE_KEYS.has(r) ? tBrands(`results.roleOne.${r as ResultRole}`) : r)

export interface NextStep { text: string; action: string; to: string }

/**
 * The one most useful thing to do next, from real counts only ("No
 * decoration", founder 2026-10-22). Replies come first in their own banner, so
 * they are not repeated here. null when there is nothing worth saying.
 */
export function nextStep(r: BrandResults, countryName: (id: number) => string | null): NextStep | null {
  const live = r.offers.filter((o) => o.status === 'live')
  if (live.length === 0) return { text: tBrands('results.next.noLive'), action: tBrands('results.next.noLiveAction'), to: '/dashboard/offers/new' }
  const missed = r.market.find((m) => !m.covered && m.n != null)
  if (missed) {
    const name = countryName(missed.country_id)
    if (name) return { text: tBrands('results.next.missed', { count: missed.n ?? 0, n: brandCount(missed.n ?? 0), country: name }), action: tBrands('results.next.missedAction'), to: '/dashboard/offers' }
  }
  const unopened = live.find((o) => o.shown >= 20 && o.opened === 0)
  if (unopened) return { text: tBrands('results.next.unopened', { title: unopened.title, count: unopened.shown, n: brandCount(unopened.shown) }), action: tBrands('results.next.unopenedAction'), to: `/dashboard/offers/${unopened.id}/edit` }
  const missing = live.find((o) => o.not_useful > Math.max(o.opened, 2))
  if (missing) return { text: tBrands('results.next.notUseful', { title: missing.title }), action: tBrands('results.next.notUsefulAction'), to: `/dashboard/offers/${missing.id}/edit` }
  return null
}
