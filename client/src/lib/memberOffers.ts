import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { OFFER_ROLES, countryInSentence, type OfferRole } from '@/lib/brandOffers'

/**
 * Brand offers, Phase 2: what members see (Figma "08 · Brands", P2; founder
 * go-ahead 2026-10-25). Eligibility lives on the server
 * (20261025100000_brand_offers_for_members): where the member lives and their
 * role, never nationality; adults only; dismissed offers and hidden brands
 * never come back. Brands only ever see totals.
 */

export interface MemberOffer {
  id: string
  brand_id: string
  title: string
  body: string
  image_url: string | null
  link_url: string
  country_ids: number[]
  area: string | null
  roles: OfferRole[]
  ends_at: string | null
  brand_name: string
  brand_slug: string
  brand_logo_url: string | null
  brand_category: string | null
  brand_country_id: number | null
  brand_profile_id: string
  brand_open_to_partners: boolean
  member_country_id: number | null
}

export interface MemberOfferDetail extends MemberOffer {
  eligible: boolean
}

export type OfferSurface = 'home' | 'home_rail' | 'hockia_ai' | 'brands_tab' | 'offer_detail' | 'marketplace' | 'need_page' | 'moment_sheet'
export type DismissReason = 'not_for_me' | 'already_have' | 'wrong_country' | 'too_many' | 'hide_brand'

export const DISMISS_REASONS: { value: DismissReason; label: string }[] = [
  { value: 'not_for_me', label: 'Not for me' },
  { value: 'already_have', label: 'Already have it' },
  { value: 'wrong_country', label: 'Wrong country' },
  { value: 'too_many', label: 'Too many offers' },
  { value: 'hide_brand', label: 'Hide this brand' },
]

// ── Server calls ────────────────────────────────────────────────────────────

export async function fetchOffersForMe(limit: number): Promise<MemberOffer[]> {
  const { data, error } = await supabase.rpc('get_brand_offers_for_me', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as unknown as MemberOffer[]
}

export async function fetchOfferDetail(offerId: string): Promise<MemberOfferDetail | null> {
  const { data, error } = await supabase.rpc('get_brand_offer_detail', { p_offer_id: offerId })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as unknown as MemberOfferDetail | undefined
  return row ?? null
}

export async function dismissOffer(offerId: string, reason: DismissReason | null): Promise<void> {
  const { error } = await supabase.rpc('dismiss_brand_offer', { p_offer_id: offerId, p_reason: reason as string })
  if (error) throw error
}

export async function undoDismissOffer(offerId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_dismiss_brand_offer', { p_offer_id: offerId })
  if (error) throw error
}

export async function hideBrandOffers(brandId: string): Promise<void> {
  const { error } = await supabase.rpc('hide_brand_offers', { p_brand_id: brandId })
  if (error) throw error
}

// ── Events (aggregates only for brands) ─────────────────────────────────────

export type OfferEvent = 'brand_offer_impression' | 'brand_offer_open' | 'brand_offer_store_tap' | 'brand_offer_contact' | 'brand_offer_dismiss'

export function trackOffer(event: OfferEvent, offerId: string, surface: OfferSurface, extra?: Record<string, unknown>): void {
  trackDbEvent(event, 'brand_offer', offerId, { offer_id: offerId, surface, ...extra })
}

/** Impressions: once per offer per visit (a visit = one mount of the surface). */
const shownThisVisit = new Map<string, Set<string>>()
export function trackImpressionOnce(visitId: string, offerId: string, surface: OfferSurface): void {
  const seen = shownThisVisit.get(visitId) ?? new Set<string>()
  if (seen.has(offerId)) return
  seen.add(offerId)
  shownThisVisit.set(visitId, seen)
  trackOffer('brand_offer_impression', offerId, surface)
}

// "Contacted" = the first message sent to the brand from an offer. Message on
// the offer remembers which offer it came from; useChat reports it when that
// message is actually sent.
const CONTACT_KEY = 'hockia-offer-contact'
export function rememberOfferContact(brandProfileId: string, offerId: string, surface: OfferSurface): void {
  try { sessionStorage.setItem(CONTACT_KEY, JSON.stringify({ brandProfileId, offerId, surface, at: Date.now() })) } catch { /* private mode */ }
}
export function reportOfferContactIfPending(recipientId: string | null | undefined): void {
  if (!recipientId) return
  try {
    const raw = sessionStorage.getItem(CONTACT_KEY)
    if (!raw) return
    const v = JSON.parse(raw) as { brandProfileId: string; offerId: string; surface: OfferSurface; at: number }
    // Only the same brand, and only within the hour the member came from the offer.
    if (v.brandProfileId !== recipientId || Date.now() - v.at > 3_600_000) return
    sessionStorage.removeItem(CONTACT_KEY)
    trackOffer('brand_offer_contact', v.offerId, v.surface)
  } catch { /* ignore */ }
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** "Players and coaches who live in England or the Netherlands" (OD1 For row). */
export function offerForLine(roles: OfferRole[], countryNames: string[]): string {
  const who = roles.map((r) => OFFER_ROLES.find((x) => x.value === r)?.label ?? r)
  const lower = who.map((w, i) => (i === 0 ? w : w.toLowerCase()))
  // Every role targeted reads as "Members" (design review 2026-10-25); a subset keeps the list.
  const everyone = OFFER_ROLES.every((x) => roles.includes(x.value))
  const whoText = everyone || lower.length === 0 ? 'Members' : lower.length === 1 ? lower[0] : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`
  const named = countryNames.map(countryInSentence)
  const where = named.length > 1 ? `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}` : named[0] ?? ''
  return where ? `${whoText} who live in ${where}` : whoText
}

/** "northlinehockey.com/hockia" from the offer link (OD1 Store row). */
export function storeLabel(link: string): string {
  try {
    const u = new URL(link)
    return (u.host.replace(/^www\./, '') + u.pathname).replace(/\/$/, '')
  } catch {
    return link
  }
}

/** OD1 reason line (no approval step since 2026-10-25, so no "checked" claim). */
export function detailReasonLine(countryName: string | null): string | null {
  return countryName ? `You see this because you live in ${countryInSentence(countryName)}.` : null
}

// ── Hockia AI: which answers may carry an offer (founder default 2026-10-25) ─

const AI_TOPICS: { topic: string; re: RegExp }[] = [
  { topic: 'moving abroad', re: /\b(mov(e|ing)|relocat\w*|abroad|another country|new country|overseas|visa|work permit)\b/i },
  { topic: 'gear', re: /\b(gear|stick|sticks|shoes?|boots?|grips?|goalkeep\w* (kit|gear|pads)|protection|shin ?guards?|equipment)\b/i },
  { topic: 'kit', re: /\b(kit|kits|jersey|shirts?|uniforms?|clothing)\b/i },
  { topic: 'training', re: /\b(training|train|drills?|fitness|conditioning|strength|coaching sessions?)\b/i },
  { topic: 'camps', re: /\b(camps?|clinics?|academy|academies)\b/i },
  { topic: 'physio', re: /\b(physio\w*|injur\w*|rehab\w*|recovery|massage)\b/i },
]

/** The topic of a member's question when it may carry an offer, else null. */
export function hockiaAiOfferTopic(question: string | null | undefined): string | null {
  const q = (question ?? '').trim()
  if (!q) return null
  return AI_TOPICS.find((t) => t.re.test(q))?.topic ?? null
}

/** H3 reason line: "Shown because you asked about moving to England. It did not change the answer." */
export function hockiaAiReasonLine(topic: string, countryName: string | null): string {
  const about = topic === 'moving abroad' && countryName ? `moving to ${countryInSentence(countryName)}` : topic
  return `Shown because you asked about ${about}. It did not change the answer.`
}
