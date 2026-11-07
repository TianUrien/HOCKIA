import { supabase } from '@/lib/supabase'

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
  if (now === before) return 'Same as before'
  const d = Math.abs(now - before)
  return now > before ? `${d} more than before` : `${d} fewer than before`
}

/** "2 days ago", "today" — the oldest message waiting for a reply. */
export function agoLine(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

const SURFACE_LABEL: Record<string, string> = {
  home: 'Home', home_rail: 'Home', hockia_ai: 'Hockia AI', marketplace: 'Brands tab', brands_tab: 'Brands tab',
  need_page: 'Brands tab', offer_detail: 'Shared link', moment_sheet: 'Home', other: 'Other',
}
export const surfaceLabel = (s: string) => SURFACE_LABEL[s] ?? 'Other'
const ROLE_LABEL: Record<string, string> = { player: 'Players', coach: 'Coaches', club: 'Clubs', umpire: 'Umpires' }
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r

export interface NextStep { text: string; action: string; to: string }

/**
 * The one most useful thing to do next, from real counts only ("No
 * decoration", founder 2026-10-22). Replies come first in their own banner, so
 * they are not repeated here. null when there is nothing worth saying.
 */
export function nextStep(r: BrandResults, countryName: (id: number) => string | null): NextStep | null {
  const live = r.offers.filter((o) => o.status === 'live')
  if (live.length === 0) return { text: 'You have no live offers. Members only see brands with an offer for them.', action: 'Create an offer', to: '/dashboard/offers/new' }
  const missed = r.market.find((m) => !m.covered && m.n != null)
  if (missed) {
    const name = countryName(missed.country_id)
    if (name) return { text: `${missed.n} members live in ${name} and none of your offers reach them.`, action: 'Add it to an offer', to: '/dashboard/offers' }
  }
  const unopened = live.find((o) => o.shown >= 20 && o.opened === 0)
  if (unopened) return { text: `“${unopened.title}” was shown to ${unopened.shown} members and nobody opened it. A photo and a perk usually help.`, action: 'Edit offer', to: `/dashboard/offers/${unopened.id}/edit` }
  const missing = live.find((o) => o.not_useful > Math.max(o.opened, 2))
  if (missing) return { text: `“${missing.title}” is marked “not useful” more than it is opened. Check who it is for.`, action: 'Edit audience', to: `/dashboard/offers/${missing.id}/edit` }
  return null
}
