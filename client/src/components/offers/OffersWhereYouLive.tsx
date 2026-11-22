import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { MarketplaceHub } from '@/components/marketplace/MarketplaceHub'
import type { MarketItem } from '@/lib/marketplace'

/** Live campaigns per brand profile for this member (the pill on brand cards), and whether every one of them is an offer. */
const OfferCountsContext = createContext<Map<string, number> | null>(null)
const OnlyOffersContext = createContext<Set<string> | null>(null)

/** How many offers this member can see from a brand (by the brand's profile id). */
// eslint-disable-next-line react-refresh/only-export-components
export function useBrandOfferCount(brandProfileId: string): number {
  return useContext(OfferCountsContext)?.get(brandProfileId) ?? 0
}

/** True when everything this brand shows the member is an offer, so the pill can say "offers"; otherwise it says "campaigns". */
// eslint-disable-next-line react-refresh/only-export-components
export function useBrandOnlyOffers(brandProfileId: string): boolean {
  return useContext(OnlyOffersContext)?.has(brandProfileId) ?? true
}

/**
 * Community › Brands: the Marketplace hub (Figma 08 · Brands P6, MK1 / MK3;
 * founder 2026-10-25, "by need and place") above "All brands", plus the
 * offer counts for the brand cards. Replaces the Phase 2 "Offers where you
 * live" rail.
 */
export function BrandOffersSection({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [onlyOffers, setOnlyOffers] = useState<Set<string>>(new Set())
  const onItems = useCallback((items: MarketItem[]) => {
    const m = new Map<string, number>()
    const other = new Set<string>()
    for (const it of items) {
      if (it.kind !== 'offer') continue
      m.set(it.brand_profile_id, (m.get(it.brand_profile_id) ?? 0) + 1)
      // No objective from an older server reads as an offer, as before.
      if (it.objective && it.objective !== 'offer') other.add(it.brand_profile_id)
    }
    setCounts(m)
    setOnlyOffers(new Set([...m.keys()].filter((id) => !other.has(id))))
  }, [])
  return (
    <OfferCountsContext.Provider value={counts}>
      <OnlyOffersContext.Provider value={onlyOffers}>
        <MarketplaceHub onItems={onItems} />
        {children}
      </OnlyOffersContext.Provider>
    </OfferCountsContext.Provider>
  )
}
