import { ChevronRight, Percent } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { liveCount, OFFER_LIVE_LIMIT, type BrandOffer } from '@/lib/brandOffers'
import type { OfferTotals } from '@/hooks/useBrandOffers'

interface OffersCardProps {
  offers: Pick<BrandOffer, 'status'>[]
  /** Last 30 days across all offers; null while unknown. */
  totals: OfferTotals | null
  onCreate: () => void
  onOpen: () => void
}

/**
 * The Offers card at the top of the brand's own dashboard (Figma 08 · Brands
 * B0 / B0b, founder 2026-10-23). No offers yet: one Primary to create the
 * first. With offers: "N of 5 live" opening the list, and the last-30-days
 * tiles once any of them is above zero.
 *
 * Not here yet, on purpose (handoff notes): the amber "N people are waiting
 * for your reply" row needs contact replies to be tracked, and "See results"
 * needs the Results panel (Phase 3). Neither is shown as a guess.
 */
export function OffersCard({ offers, totals, onCreate, onOpen }: OffersCardProps) {
  const tile = (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-brand-soft text-brand-primary" aria-hidden="true">
      <Percent className="h-5 w-5" strokeWidth={2} />
    </span>
  )

  if (offers.length === 0) {
    return (
      <div className="px-4">
        <div className="rounded-[24px] border border-line bg-white p-4" data-testid="brand-offers-card">
          <div className="flex items-start gap-3">
            {tile}
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold leading-[22px] text-ink-1">Offers</span>
              <span className="mt-0.5 block text-row text-ink-2">Bring something useful to members where they live. Free, checked by an admin.</span>
            </span>
          </div>
          <Button block className="mt-4 rounded-full" onClick={onCreate} data-testid="brand-offers-create">Create your first offer</Button>
        </div>
      </div>
    )
  }

  const tiles = totals && (totals.shown > 0 || totals.opened > 0 || totals.contacted > 0)
    ? [
        { value: totals.shown, label: 'Shown to' },
        { value: totals.opened, label: 'Opened' },
        { value: totals.contacted, label: 'Contacted' },
      ]
    : null

  return (
    <div className="px-4">
      <div className="rounded-[24px] border border-line bg-white p-4" data-testid="brand-offers-card">
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left" data-testid="brand-offers-link">
          {tile}
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-[22px] text-ink-1">Offers</span>
            <span className="mt-0.5 block text-row text-ink-2">{liveCount(offers)} of {OFFER_LIVE_LIMIT} live</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" aria-hidden="true" />
        </button>
        {tiles ? (
          <>
            <button type="button" onClick={onOpen} className="mt-3 grid w-full grid-cols-3 gap-2 text-left" aria-label="Offer results, last 30 days" data-testid="brand-offers-tiles">
              {tiles.map((t) => (
                <span key={t.label} className="rounded-[14px] bg-surface-subtle px-3 py-2.5">
                  <span className="block text-title tabular-nums text-ink-1">{t.value}</span>
                  <span className="block text-secondary text-ink-2">{t.label}</span>
                </span>
              ))}
            </button>
            <p className="mt-2 text-secondary text-ink-3">Last 30 days</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
