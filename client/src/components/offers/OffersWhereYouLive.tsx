import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useOffersForMe, useVisitId } from '@/hooks/useMemberOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import type { MemberOffer } from '@/lib/memberOffers'
import { countryInSentence } from '@/lib/brandOffers'
import { OfferRailTile } from './MemberOfferCard'

/** Live offers per brand profile for this member (the "N offers" pill on brand cards). */
const OfferCountsContext = createContext<Map<string, number> | null>(null)

/** How many offers this member can see from a brand (by the brand's profile id). */
// eslint-disable-next-line react-refresh/only-export-components
export function useBrandOfferCount(brandProfileId: string): number {
  return useContext(OfferCountsContext)?.get(brandProfileId) ?? 0
}

/**
 * Community › Brands (Figma 08 · Brands P2 BT1 / BT2): "Offers where you live"
 * as a horizontal rail above the brands, and the counts for the brand cards.
 * The whole section is hidden when the member has no eligible offer.
 */
export function BrandOffersSection({ children }: { children: ReactNode }) {
  const visitId = useVisitId()
  const { data } = useOffersForMe(20, { visitId })
  const offers: MemberOffer[] = useMemo(() => data ?? [], [data])
  const names = useCountryNames()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of offers) m.set(o.brand_profile_id, (m.get(o.brand_profile_id) ?? 0) + 1)
    return m
  }, [offers])
  const country = offers[0]?.member_country_id != null ? names([offers[0].member_country_id])[0] ?? null : null

  return (
    <OfferCountsContext.Provider value={counts}>
      {offers.length > 0 ? (
        <section className="mb-6" aria-labelledby="offers-where-you-live" data-testid="brand-offers-rail">
          <h2 id="offers-where-you-live" className="text-title text-ink-1">Offers where you live</h2>
          <p className="mt-0.5 text-row text-ink-2">{country ? `From brands, for members in ${countryInSentence(country)}` : 'From brands, for members where you live'}</p>
          <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
            {offers.map((o) => <OfferRailTile key={o.id} offer={o} visitId={visitId} />)}
          </div>
          <h2 className="mt-6 text-title text-ink-1">All brands</h2>
        </section>
      ) : null}
      {children}
    </OfferCountsContext.Provider>
  )
}
