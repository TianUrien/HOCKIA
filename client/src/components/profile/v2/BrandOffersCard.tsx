import { ChevronRight, Percent } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { liveCount, OFFER_LIVE_LIMIT, type BrandOffer } from '@/lib/brandOffers'
import type { OfferTotals } from '@/hooks/useBrandOffers'
import { useBrandsT } from '@/i18n/ns/brands'
import { formatNumber, isEnglish } from '@/i18n/format'

/** A count as the interface language writes it; English keeps the plain digits it always showed. */
const count = (n: number) => (isEnglish() ? String(n) : formatNumber(n))

interface OffersCardProps {
  offers: Pick<BrandOffer, 'status'>[]
  /** Last 30 days across all offers; null while unknown. */
  totals: OfferTotals | null
  onCreate: () => void
  onOpen: () => void
  /** Results screen (2026-11-07); the link shows when set. */
  onResults?: () => void
  /** Desktop dashboard (rebrand page 27): its own white card, Satoshi title, "Open offers ›". */
  desktop?: boolean
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
export function OffersCard({ offers, totals, onCreate, onOpen, onResults, desktop = false }: OffersCardProps) {
  const t = useBrandsT()
  const wrap = desktop ? '' : 'px-4'
  const box = desktop ? 'rounded-[24px] bg-white p-6 ring-1 ring-inset ring-line' : 'rounded-[24px] border border-line bg-white p-4'
  const title = desktop ? 'block font-display text-[24px] font-bold leading-[1.2] text-ink-1' : 'block text-[17px] font-semibold leading-[22px] text-ink-1'
  const tile = (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-brand-soft text-brand-primary" aria-hidden="true">
      <Percent className="h-5 w-5" strokeWidth={2} />
    </span>
  )

  if (offers.length === 0) {
    return (
      <div className={wrap}>
        <div className={box} data-testid="brand-offers-card">
          <div className="flex items-start gap-3">
            {tile}
            <span className="min-w-0 flex-1">
              <span className={title}>{t('offersCard.title')}</span>
              <span className="mt-0.5 block text-row text-ink-2">{t('offersCard.emptyBody')}</span>
            </span>
          </div>
          <Button block={!desktop} className="mt-4 rounded-full" onClick={onCreate} data-testid="brand-offers-create">{t('offersCard.createFirst')}</Button>
        </div>
      </div>
    )
  }

  // "0 of 5 live" alone reads as if nothing happened: say what is waiting.
  const live = liveCount(offers)
  const drafts = offers.filter((o) => o.status === 'draft' || o.status === 'in_review').length
  const liveText = t('offersCard.liveOf', { live: count(live), limit: count(OFFER_LIVE_LIMIT) })
  const subtitle = live === 0 && drafts > 0
    ? t('offersCard.subtitleWithDrafts', { live: liveText, drafts: t('offersCard.drafts', { count: drafts }) })
    : liveText

  const tiles = totals && (totals.shown > 0 || totals.opened > 0 || totals.contacted > 0 || totals.store_visits > 0)
    ? [
        { key: 'shown', value: totals.shown, label: t('offersCard.tileShown') },
        { key: 'opened', value: totals.opened, label: t('offersCard.tileOpened') },
        { key: 'store', value: totals.store_visits, label: t('offersCard.tileStore') },
        { key: 'contacted', value: totals.contacted, label: t('offersCard.tileContacted') },
      ]
    : null

  return (
    <div className={wrap}>
      <div className={box} data-testid="brand-offers-card">
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left" data-testid="brand-offers-link">
          {!desktop && tile}
          <span className="min-w-0 flex-1">
            <span className={title}>{t('offersCard.title')}</span>
            <span className={desktop ? 'mt-0.5 block text-secondary text-ink-2' : 'mt-0.5 block text-row text-ink-2'}>{subtitle}</span>
          </span>
          {desktop
            ? <span className="shrink-0 text-[14px] font-medium text-brand-text">{t('offersCard.openOffers')}</span>
            : <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" aria-hidden="true" />}
        </button>
        {tiles ? (
          <>
            <button type="button" onClick={onOpen} className="mt-3 grid w-full grid-cols-2 gap-2 text-left sm:grid-cols-4" aria-label={t('offersCard.tilesLabel')} data-testid="brand-offers-tiles">
              {tiles.map((tile) => (
                <span key={tile.key} className="rounded-[14px] bg-surface-subtle px-3 py-2.5">
                  <span className="block text-title tabular-nums text-ink-1">{count(tile.value)}</span>
                  <span className="block text-secondary text-ink-2">{tile.label}</span>
                </span>
              ))}
            </button>
            <p className="mt-2 text-secondary text-ink-3">{t('offersCard.last30')}</p>
          </>
        ) : null}
        {onResults ? (
          <button type="button" onClick={onResults} className="mt-2 flex h-11 w-full items-center justify-end text-row font-semibold text-brand-primary" data-testid="brand-offers-results">{t('offersCard.seeResults')}</button>
        ) : null}
      </div>
    </div>
  )
}
