import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { OFFER_ROLES, countryInSentence, offerRegionLabel, type OfferObjective, type OfferRole } from '@/lib/brandOffers'
import { withLazyText } from '@/lib/opportunityLazyText'
import { formatList, isEnglish } from '@/i18n/format'
import { tBrands } from '@/i18n/ns/brands'
import { takeOfferContact, writeOfferContact } from '@/lib/offerContactMarker'

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
  /** Reach (2026-11-07); absent from servers before it. */
  everywhere?: boolean
  regions?: string[]
  perk?: string | null
}

export interface MemberOfferDetail extends MemberOffer {
  eligible: boolean
  /** Signed-in members only. */
  promo_code?: string | null
}

export type OfferSurface = 'home' | 'home_rail' | 'hockia_ai' | 'brands_tab' | 'offer_detail' | 'marketplace' | 'need_page' | 'moment_sheet'
export type DismissReason = 'not_for_me' | 'already_have' | 'wrong_country' | 'too_many' | 'hide_brand'

// Labels are read on each use (the language is not known when this module loads).
const dismissReason = (value: DismissReason, key: 'notForMe' | 'alreadyHave' | 'wrongCountry' | 'tooMany' | 'hideBrand') => withLazyText({ value }, { label: () => tBrands(`memberOffers.dismiss.${key}`) })
export const DISMISS_REASONS: { value: DismissReason; label: string }[] = [
  dismissReason('not_for_me', 'notForMe'),
  dismissReason('already_have', 'alreadyHave'),
  dismissReason('wrong_country', 'wrongCountry'),
  dismissReason('too_many', 'tooMany'),
  dismissReason('hide_brand', 'hideBrand'),
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

/**
 * What the campaign asks the member to do (2026-11-21). Read from the public
 * column of a live campaign; before the column exists, or on any failure, it
 * is an offer, so the page keeps its store button.
 */
export async function fetchOfferObjective(offerId: string): Promise<OfferObjective> {
  const { data, error } = await supabase.from('brand_offers').select('objective').eq('id', offerId).maybeSingle()
  if (error) return 'offer'
  const v = (data as { objective?: string } | null)?.objective
  return v === 'ask' || v === 'product' || v === 'ambassador' ? v : 'offer'
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

export type OfferEvent = 'brand_offer_impression' | 'brand_offer_open' | 'brand_offer_store_tap' | 'brand_offer_contact' | 'brand_offer_dismiss' | 'brand_offer_code_copy'

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

// "Contacted" = the first message sent to the brand from a campaign. Message
// on the campaign remembers which one it came from; useChat reports it when
// that message is actually sent. The marker belongs to one member and one
// brand, lasts 24 hours (2026-11-21; it was one hour of the same tab, which
// lost a member who reopened the app to write), is used once, and is removed
// on sign-out (lib/offerContactMarker.ts).
export function rememberOfferContact(memberId: string, brandProfileId: string, offerId: string, surface: OfferSurface): void {
  writeOfferContact(memberId, brandProfileId, { offerId, surface, at: Date.now() })
}
export function reportOfferContactIfPending(memberId: string | null | undefined, recipientId: string | null | undefined): void {
  if (!memberId || !recipientId) return
  const v = takeOfferContact(memberId, recipientId)
  if (v) trackOffer('brand_offer_contact', v.offerId, v.surface as OfferSurface)
}

// ── Copy ────────────────────────────────────────────────────────────────────

const ROLE_KEYS = { player: 'players', coach: 'coaches', club: 'clubs', umpire: 'umpires' } as const satisfies Record<OfferRole, string>
const hasKey = <T extends object>(map: T, k: string): k is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(map, k)

/** "a, b and c" (English keeps its own form, no serial comma); Intl lists elsewhere. */
function joinWords(items: string[], type: 'conjunction' | 'disjunction'): string {
  if (!isEnglish()) return formatList(items, type)
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${type === 'conjunction' ? 'and' : 'or'} ${items[items.length - 1]}` : items[0] ?? ''
}

/** A region of offer reach (stored in English) in the interface language; one table, kept in brandOffers. */
export { offerRegionLabel }

/** "Players and coaches who live in England or the Netherlands" (OD1 For row). */
export function offerForLine(roles: OfferRole[], countryNames: string[], place?: { everywhere?: boolean; regions?: string[] }): string {
  const who = roles.map((r) => (hasKey(ROLE_KEYS, r) ? tBrands(`memberOffers.role.${ROLE_KEYS[r]}`) : r))
  const lower = who.map((w, i) => (i === 0 ? w : w.toLocaleLowerCase(isEnglish() ? 'en' : undefined)))
  // Every role targeted reads as "Members" (design review 2026-10-25); a subset keeps the list.
  const everyone = OFFER_ROLES.every((x) => roles.includes(x.value))
  const whoText = everyone || lower.length === 0 ? tBrands('memberOffers.forLine.members') : joinWords(lower, 'conjunction')
  if (place?.everywhere) return tBrands('memberOffers.forLine.everywhere', { who: whoText })
  const named = [...(place?.regions ?? []).map(offerRegionLabel), ...countryNames.map(countryInSentence)]
  const where = joinWords(named, 'disjunction')
  return where ? tBrands('memberOffers.forLine.liveIn', { who: whoText, where }) : whoText
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
export function detailReasonLine(countryName: string | null, everywhere = false): string | null {
  if (everywhere) return tBrands('memberOffers.detailReason.everywhere')
  return countryName ? tBrands('memberOffers.detailReason.liveIn', { country: countryInSentence(countryName) }) : null
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

/** Topic tokens (also sent with events) to their catalog keys. */
const AI_TOPIC_KEYS = { 'moving abroad': 'movingAbroad', gear: 'gear', kit: 'kit', training: 'training', camps: 'camps', physio: 'physio' } as const

/** The topic of a member's question when it may carry an offer, else null. */
export function hockiaAiOfferTopic(question: string | null | undefined): string | null {
  const q = (question ?? '').trim()
  if (!q) return null
  return AI_TOPICS.find((t) => t.re.test(q))?.topic ?? null
}

/** H3 reason line: "Shown because you asked about moving to England. It did not change the answer." */
export function hockiaAiReasonLine(topic: string, countryName: string | null): string {
  const about = topic === 'moving abroad' && countryName
    ? tBrands('memberOffers.aiTopic.movingTo', { country: countryInSentence(countryName) })
    : hasKey(AI_TOPIC_KEYS, topic) ? tBrands(`memberOffers.aiTopic.${AI_TOPIC_KEYS[topic]}`) : topic
  return tBrands('memberOffers.aiReason', { about })
}
