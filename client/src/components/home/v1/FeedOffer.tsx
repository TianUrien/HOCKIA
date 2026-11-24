import { useAuthStore } from '@/lib/auth'
import { useOffersForMe, useVisitId } from '@/hooks/useMemberOffers'
import { MemberOfferCard } from '@/components/offers/MemberOfferCard'
import { FeedBand } from './primitives'

/**
 * One brand offer in the Home feed (founder 2026-11-24: the gear rail left
 * Home; an offer shows as a brand's card between posts instead). At most one
 * per visit, fixed for the visit, only an offer this member is eligible for,
 * labelled "From brands" with "Not useful" (MemberOfferCard). Brands never
 * get offers from other brands. Renders nothing when there is no offer.
 */
export function FeedOffer() {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const visitId = useVisitId()
  const { data } = useOffersForMe(1, { visitId })
  const offer = data?.[0]
  if (!offer) return null
  return (
    <>
      <FeedBand />
      <div className="px-4 py-4" data-testid="home-feed-offer">
        <MemberOfferCard offer={offer} surface="home" visitId={visitId} role={role} />
      </div>
    </>
  )
}
