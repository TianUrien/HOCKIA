import { useOffersForMe } from '@/hooks/useMemberOffers'
import { MemberOfferCard } from './MemberOfferCard'

/**
 * One offer under a finished Hockia AI answer (Figma 08 · Brands P2 H3):
 * below a thin "From brands" divider, never inside the answer, and the answer
 * is never changed. Renders nothing when no offer is eligible.
 */
export function HockiaAiOffer({ answerId, topic, role }: { answerId: string; topic: string; role: string | null }) {
  const { data } = useOffersForMe(1, { visitId: `ai-${answerId}` })
  const offer = data?.[0]
  if (!offer) return null
  return (
    <div className="mt-4" data-testid="hockia-ai-offer">
      <div className="mb-3 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-secondary font-semibold text-ink-2">From brands</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <MemberOfferCard offer={offer} surface="hockia_ai" visitId={`ai-${answerId}`} role={role} aiTopic={topic} />
    </div>
  )
}
