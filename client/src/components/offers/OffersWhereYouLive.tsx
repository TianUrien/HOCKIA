import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { MarketplaceHub } from '@/components/marketplace/MarketplaceHub'
import type { MarketItem } from '@/lib/marketplace'

/** Live offers per brand profile for this member (the "N offers" pill on brand cards). */
const OfferCountsContext = createContext<Map<string, number> | null>(null)

/** How many offers this member can see from a brand (by the brand's profile id). */
// eslint-disable-next-line react-refresh/only-export-components
export function useBrandOfferCount(brandProfileId: string): number {
  return useContext(OfferCountsContext)?.get(brandProfileId) ?? 0
}

/**
 * Community › Brands: the Marketplace hub (Figma 08 · Brands P6, MK1 / MK3;
 * founder 2026-10-25, "by need and place") above "All brands", plus the
 * offer counts for the brand cards. Replaces the Phase 2 "Offers where you
 * live" rail.
 */
export function BrandOffersSection({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const onItems = useCallback((items: MarketItem[]) => {
    const m = new Map<string, number>()
    for (const it of items) if (it.kind === 'offer') m.set(it.brand_profile_id, (m.get(it.brand_profile_id) ?? 0) + 1)
    setCounts(m)
  }, [])
  return (
    <OfferCountsContext.Provider value={counts}>
      <MarketplaceHub onItems={onItems} />
      {children}
    </OfferCountsContext.Provider>
  )
}
