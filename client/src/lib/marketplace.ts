import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { withLazyText } from '@/lib/opportunityLazyText'
import { tBrands } from '@/i18n/ns/brands'

/**
 * Marketplace by need and place (founder 2026-10-25; Figma page 08, P6:
 * MK1–MK4). Community › Brands is the hub: what members need for their next
 * step in hockey, where they live or are moving to. No checkout: purchases
 * stay on the brand's own site. Data: get_marketplace (20261025170000).
 */

export type Need = 'gear' | 'moving_abroad' | 'training_recovery' | 'for_clubs'

/** The four needs. Labels are read through getters so they follow the interface language. */
export const NEEDS: { key: Need; label: string; subtitle: string; pageSubtitle: string }[] = [
  withLazyText({ key: 'gear' as Need }, { label: () => tBrands('needs.gear'), subtitle: () => tBrands('needSubtitles.gear'), pageSubtitle: () => tBrands('needPageSubtitles.gear') }),
  withLazyText({ key: 'moving_abroad' as Need }, { label: () => tBrands('needs.moving_abroad'), subtitle: () => tBrands('needSubtitles.moving_abroad'), pageSubtitle: () => tBrands('needPageSubtitles.moving_abroad') }),
  withLazyText({ key: 'training_recovery' as Need }, { label: () => tBrands('needs.training_recovery'), subtitle: () => tBrands('needSubtitles.training_recovery'), pageSubtitle: () => tBrands('needPageSubtitles.training_recovery') }),
  withLazyText({ key: 'for_clubs' as Need }, { label: () => tBrands('needs.for_clubs'), subtitle: () => tBrands('needSubtitles.for_clubs'), pageSubtitle: () => tBrands('needPageSubtitles.for_clubs') }),
]

export function needLabel(need: string | null | undefined): string {
  return NEEDS.find((n) => n.key === need)?.label ?? tBrands('needs.gear')
}

export function isNeed(v: string | null | undefined): v is Need {
  return NEEDS.some((n) => n.key === v)
}

export interface MarketItem {
  kind: 'offer' | 'product'
  id: string
  brand_id: string
  brand_name: string
  brand_slug: string
  brand_logo_url: string | null
  brand_profile_id: string
  brand_category: string | null
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  need: Need
  created_at: string
  country_id: number
  base_country_id: number | null
  perk?: string | null
  /** What the campaign asks members to do. Absent on a product row and from a server that predates 2026-11-22. */
  objective?: 'ask' | 'product' | 'offer' | 'ambassador' | null
}

export async function fetchMarketplace(countryId: number | null): Promise<MarketItem[]> {
  const { data, error } = await supabase.rpc('get_marketplace', { p_country_id: countryId as number })
  if (error) throw error
  return (data ?? []) as unknown as MarketItem[]
}

export async function suggestBrand(name: string, link: string | null, countryId: number | null, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('suggest_brand', {
    p_brand_name: name.trim(),
    p_link: (link ?? '').trim() || (null as unknown as string),
    p_country_id: countryId as number,
    p_note: (note ?? '').trim() || (null as unknown as string),
  })
  if (error) throw error
}

/** The need of each of the signed-in brand's own offers and products (with the category default). */
export async function fetchMyItemNeeds(): Promise<Map<string, Need>> {
  const { data, error } = await supabase.rpc('get_my_brand_item_needs')
  if (error) throw error
  return new Map(((data ?? []) as { id: string; need: Need }[]).map((r) => [r.id, r.need]))
}

export async function setOfferNeed(offerId: string, need: Need | null): Promise<void> {
  const { error } = await supabase.rpc('set_brand_offer_need', { p_offer_id: offerId, p_need: need as string })
  if (error) throw error
}

export async function setProductNeed(productId: string, need: Need | null): Promise<void> {
  const { error } = await supabase.rpc('set_brand_product_need', { p_product_id: productId, p_need: need as string })
  if (error) throw error
}

// ── Layout rules (MK1 / MK3) ────────────────────────────────────────────────

/** Fewer items than this in a country: one honest list, no need rails (MK3). */
export const LOW_SUPPLY = 6
/** A need rail needs at least this many items; otherwise they fold into "Near you". */
export const RAIL_MIN = 2

const MOVE_GOALS = ['play_abroad', 'coach_abroad', 'umpire_abroad']

/** Rails in the order the member most likely needs them (MK1 rule 5). */
export function needOrder(role: string | null, goalOptions: string[]): Need[] {
  const lead: Need = goalOptions.some((g) => MOVE_GOALS.includes(g)) ? 'moving_abroad' : role === 'club' ? 'for_clubs' : 'gear'
  return [lead, ...NEEDS.map((n) => n.key).filter((k) => k !== lead)]
}

export function itemsByNeed(items: MarketItem[]): Map<Need, MarketItem[]> {
  const m = new Map<Need, MarketItem[]>()
  for (const it of items) m.set(it.need, [...(m.get(it.need) ?? []), it])
  return m
}

/** Offers first, then the rest newest first (MK2 list order). */
export function sortForList(items: MarketItem[]): MarketItem[] {
  return [...items].sort((a, b) => (a.kind === b.kind ? Date.parse(b.created_at) - Date.parse(a.created_at) : a.kind === 'offer' ? -1 : 1))
}

export function distinctBrands(items: MarketItem[]): number {
  return new Set(items.map((i) => i.brand_id)).size
}

// ── Events ──────────────────────────────────────────────────────────────────

export type MarketSurface = 'marketplace' | 'need_page' | 'moment_sheet'

export function trackMarket(event: 'marketplace_view' | 'need_open' | 'moment_sheet_view' | 'moment_sheet_action' | 'brand_suggest', props: Record<string, unknown>): void {
  trackDbEvent(event, 'marketplace', undefined, props)
}

/** Tap on an item: offers keep their own events; products count as store taps. */
export function trackItemOpen(item: MarketItem, surface: MarketSurface): void {
  if (item.kind === 'offer') trackDbEvent('brand_offer_open', 'brand_offer', item.id, { offer_id: item.id, surface })
  else trackDbEvent('brand_product_click', 'brand_product', item.id, { brand_id: item.brand_id, surface })
}

export function trackItemImpression(item: MarketItem, surface: MarketSurface): void {
  if (item.kind === 'offer') trackDbEvent('brand_offer_impression', 'brand_offer', item.id, { offer_id: item.id, surface })
  else trackDbEvent('brand_product_impression', 'brand_product', item.id, { brand_id: item.brand_id, surface })
}
