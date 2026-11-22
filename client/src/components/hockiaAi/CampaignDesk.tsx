import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { UserBubble } from '@/components/discover/UserBubble'
import { useMyBrandOffers } from '@/hooks/useBrandOffers'
import { fetchBrandResults } from '@/lib/brandResults'
import {
  OFFER_OBJECTIVES,
  SMALL_AUDIENCE,
  brandCount,
  campaignCount,
  campaignHeadline,
  isFewer,
  campaignRanDays,
  closingLine,
  isSmallAudience,
  daysLeftLine,
  deskCampaignTotal,
  deskCampaigns,
  isLinkOnly,
  offerShownFields,
  shortDate,
  type BrandOffer,
} from '@/lib/brandOffers'
import { OfferPill, OfferThumb } from '@/components/brands/offers/OfferParts'
import { useBrandsT } from '@/i18n/ns/brands'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'
import { MascotAvatar } from './mascot'

function Turn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-2 border-[rgba(168,140,250,0.5)]">
        <MascotAvatar size={36} />
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  )
}

interface CampaignDeskProps {
  /** Leaves the sheet for a screen. */
  onGo: (to: string) => void
  /** The campaign the member came to see (the one the dot announced): always the first card. */
  focusId?: string | null
}

/**
 * "How are my campaigns doing?" answered inside Hockia AI (founder
 * 2026-11-21: chat to ask and decide, cards to see and act). The answer is a
 * card per campaign with the same numbers as the campaign report. Nothing
 * here is written by the language model: every figure is read from the
 * brand's own results and every sentence is a template, so it cannot invent a
 * number and it does not use one of the day's questions.
 */
export function CampaignDesk({ onGo, focusId = null }: CampaignDeskProps) {
  const t = useHockiaAiT()
  const tb = useBrandsT()
  const { offers, isLoading, isError } = useMyBrandOffers(true)
  const results = useQuery({ queryKey: ['brand-results', 90], queryFn: () => fetchBrandResults(90), staleTime: 60_000 })
  const cards = deskCampaigns(offers, focusId)
  const waiting = results.data?.waiting.count ?? 0
  const total = deskCampaignTotal(offers)
  const liveCount = offers.filter((o) => o.status === 'live').length
  const pausedCount = offers.filter((o) => o.status === 'paused').length
  // A failed refresh with campaigns already in hand still shows them; the error line is for having nothing to show.
  const failed = isError && cards.length === 0

  // "The cards were shown": once, when there are cards on screen.
  const reported = useRef(false)
  useEffect(() => {
    if (reported.current || isLoading || cards.length === 0) return
    reported.current = true
    trackDbEvent('hockia_ai_campaigns_view', undefined, undefined, { cards: cards.length })
  }, [isLoading, cards.length])

  const lead = failed
    ? t('campaigns.error')
    : cards.length === 0
      ? t('campaigns.none')
      : [
          liveCount > 0 ? t('campaigns.leadLive', { count: liveCount }) : pausedCount > 0 ? t('campaigns.leadPaused', { count: pausedCount }) : t('campaigns.leadEnded'),
          // Never "5 live campaigns" above three cards without saying so.
          total > cards.length ? t('campaigns.leadSome', { count: cards.length, total }) : null,
        ].filter(Boolean).join(' ')

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 lg:px-6" data-testid="hockia-ai-campaigns">
      <div className="flex flex-col gap-3 pt-1">
        <UserBubble text={t('options.brandOffersMonth')} />
        <Turn>
          {isLoading ? <div className="h-24 animate-pulse rounded-[20px] bg-white" aria-busy="true" /> : (
            <>
              <p className="text-[16px] leading-[22px] text-ink-1" data-testid="hockia-ai-campaigns-lead">{lead}</p>
              {waiting > 0 ? (
                // The brand's inbox, from any campaign or none: said once, apart from each campaign's own numbers.
                <button type="button" onClick={() => onGo('/messages')} className="mt-3 flex w-full items-center justify-between gap-3 rounded-[16px] bg-status-warning-soft px-3.5 py-3 text-left" data-testid="hockia-ai-campaigns-inbox">
                  <span className="text-row font-semibold text-status-warning">{tb('campaignReport.inbox', { count: waiting, n: brandCount(waiting) })}</span>
                  <span className="shrink-0 text-row font-semibold text-status-warning">{tb('campaignReport.reply')}</span>
                </button>
              ) : null}
              <div className="mt-3 space-y-3">
                {cards.map((o) => <CampaignChatCard key={o.id} offer={o} onGo={onGo} />)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onGo('/dashboard/offers/new')} className="inline-flex h-11 items-center rounded-full bg-brand-soft px-5 text-body font-semibold text-brand-primary" data-testid="hockia-ai-campaigns-new">{t('campaigns.new')}</button>
                {cards.length > 0 ? <button type="button" onClick={() => onGo('/dashboard/offers')} className="inline-flex h-11 items-center px-2 text-body font-semibold text-ink-2">{t('campaigns.all')}</button> : null}
              </div>
              {cards.length > 0 ? <p className="mt-3 text-caption text-ink-3" data-testid="hockia-ai-campaigns-source">{t('campaigns.source')}</p> : null}
            </>
          )}
        </Turn>
      </div>
    </div>
  )
}

/** One campaign as a card in the chat: the same reading as its report, in small. */
export function CampaignChatCard({ offer, onGo }: { offer: BrandOffer; onGo: (to: string) => void }) {
  const t = useHockiaAiT()
  const tb = useBrandsT()
  const shown = offerShownFields(offer)
  const objective = shown.objective ?? 'offer'
  const headline = campaignHeadline({ ...offer, objective })
  const ended = offer.status === 'ended'
  // Under five members no count is shown: exact numbers would say what one person did (founder 2026-11-21).
  const small = isSmallAudience(offer)
  const when = ended
    ? t('campaigns.endedOn', { date: shortDate(offer.ended_at ?? offer.ends_at ?? offer.updated_at) })
    : offer.status === 'live' ? daysLeftLine(offer) : null
  const cells = [
    { key: 'shown', label: tb('campaignReport.rows.shown'), n: offer.shown },
    { key: 'opened', label: tb('campaignReport.rows.opened'), n: offer.opened },
    { key: 'notUseful', label: t('campaigns.notUseful'), n: offer.not_useful },
  ]
  return (
    <div className="rounded-[20px] border border-line bg-white p-3.5" data-testid="hockia-ai-campaign-card" data-status={offer.status}>
      <div className="flex items-start gap-3">
        <OfferThumb url={shown.image_url} className="h-12 w-12 shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-body font-semibold text-ink-1">{shown.title || tb('offerParts.untitled')}</p>
          <p className="mt-0.5 text-secondary text-ink-2">{[OFFER_OBJECTIVES.find((x) => x.value === objective)?.label, when].filter(Boolean).join('. ')}</p>
          <div className="mt-1.5"><OfferPill offer={offer} /></div>
        </div>
      </div>

      {small ? (
        <p className="mt-3 font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink-1" data-testid="hockia-ai-campaign-number">{tb('campaignReport.fewer', { n: SMALL_AUDIENCE })}</p>
      ) : (
        <>
          <p className="mt-3 flex items-baseline gap-2">
            <span className={cn('font-display font-bold leading-none tracking-[-0.03em] text-ink-1', isFewer(headline.n) ? 'text-[22px]' : 'text-[32px]')} data-testid="hockia-ai-campaign-number">{campaignCount(headline.n)}</span>
            <span className="text-row text-ink-2">{tb(`campaignReport.headline.${headline.key}`, { count: isFewer(headline.n) ? SMALL_AUDIENCE : headline.n })}</span>
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2" data-testid="hockia-ai-campaign-cells">
            {cells.map((c) => (
              <div key={c.key} className="rounded-[12px] bg-surface-subtle px-2.5 py-2">
                <p className="truncate text-caption text-ink-2">{c.label}</p>
                <p className="truncate text-body font-semibold text-ink-1">{campaignCount(c.n)}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <p className={cn('mt-3 text-row text-ink-2', ended && 'text-ink-1')} data-testid="hockia-ai-campaign-reading">
        {ended
          ? closingLine(offer, campaignRanDays(offer), headline)
          : small
            ? tb('campaignReport.small', { n: SMALL_AUDIENCE })
            : isLinkOnly(offer)
              ? tb('campaignReport.linkOnly')
              : offer.shown === 0
                ? tb('campaignReport.nobody')
                : t('campaigns.reading', { count: offer.shown, shown: brandCount(offer.shown), opened: isFewer(offer.opened) ? tb('offers.counts.fewerN', { n: SMALL_AUDIENCE }) : brandCount(offer.opened) })}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => onGo(`/dashboard/offers/${offer.id}/report`)} className="inline-flex h-11 items-center rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary" data-testid="hockia-ai-campaign-report">{t('campaigns.report')}</button>
        {ended ? null : <button type="button" onClick={() => onGo(`/dashboard/offers/${offer.id}/edit`)} className="inline-flex h-11 items-center px-2 text-row font-semibold text-ink-2">{tb('campaignReport.edit')}</button>}
      </div>
    </div>
  )
}
