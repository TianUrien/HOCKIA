import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { offerReasonLine } from '@/lib/brandOffers'
import {
  DISMISS_REASONS,
  dismissOffer,
  hockiaAiReasonLine,
  trackOffer,
  undoDismissOffer,
  type DismissReason,
  type MemberOffer,
  type OfferSurface,
} from '@/lib/memberOffers'
import { useOfferImpression } from '@/hooks/useMemberOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { chipTone } from '@/components/ui/chipClasses'
import { BrandLogo, OfferHero } from './OfferVisuals'

/**
 * Member-facing offer cards (Figma "08 · Brands", P2): H1 / H1-no-image on
 * Home, the compact card under a Hockia AI answer (H3), and the "Not useful"
 * fold with Undo and optional reasons (H2). Always labelled "From brands";
 * the reason line uses where the member lives and their role, never
 * nationality. No amber on these surfaces.
 */

interface CardProps {
  offer: MemberOffer
  surface: OfferSurface
  visitId: string
  role: string | null
  /** Compact card under a Hockia AI answer (H3): the topic the member asked about. */
  aiTopic?: string
}

export function MemberOfferCard({ offer, surface, visitId, role, aiTopic }: CardProps) {
  const navigate = useNavigate()
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const [state, setState] = useState<'shown' | 'dismissed' | 'reasoned'>('shown')
  const ref = useOfferImpression<HTMLDivElement>(state === 'shown' ? offer.id : null, surface, visitId)
  const country = names(offer.member_country_id != null ? [offer.member_country_id] : [])[0] ?? null

  const open = () => {
    trackOffer('brand_offer_open', offer.id, surface)
    navigate(`/offers/${offer.id}`, { state: { surface } })
  }
  const notUseful = async () => {
    setState('dismissed')
    trackOffer('brand_offer_dismiss', offer.id, surface)
    try {
      await dismissOffer(offer.id, null)
    } catch (err) {
      logger.error('[MemberOfferCard] dismiss failed', err)
      setState('shown')
      addToast('Could not hide this offer. Please try again.', 'error')
    }
  }
  const undo = async () => {
    setState('shown')
    try {
      await undoDismissOffer(offer.id)
    } catch (err) {
      logger.error('[MemberOfferCard] undo failed', err)
    }
  }
  const reason = async (r: DismissReason) => {
    setState('reasoned')
    trackOffer('brand_offer_dismiss', offer.id, surface, { reason: r })
    try {
      await dismissOffer(offer.id, r)
    } catch (err) {
      logger.error('[MemberOfferCard] reason failed', err)
    }
  }

  if (state !== 'shown') {
    return (
      <div className="rounded-[24px] border border-line bg-white p-4" data-testid="member-offer-dismissed">
        <div className="flex items-start justify-between gap-3">
          <p className="text-body font-semibold text-ink-1">Got it. You&rsquo;ll see fewer offers like this.</p>
          <button type="button" onClick={() => void undo()} className="-my-2 flex h-11 shrink-0 items-center text-body font-semibold text-brand-primary" data-testid="member-offer-undo">Undo</button>
        </div>
        {state === 'dismissed' ? (
          <>
            <p className="mt-1 text-row text-ink-2">Tell us why (optional, the brand only sees totals)</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DISMISS_REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => void reason(r.value)} className={cn('h-9 rounded-full px-4 text-row', chipTone(false))}>
                  {r.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  const reasonText = aiTopic ? hockiaAiReasonLine(aiTopic, country) : offerReasonLine(country, role)
  const reasonBox = (
    <p className="mt-3 flex gap-2 rounded-[14px] bg-surface-subtle p-3 text-row text-ink-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
      {reasonText}
    </p>
  )
  const actions = (
    <div className="mt-3 flex items-center justify-between">
      <button type="button" onClick={open} className="inline-flex h-11 items-center rounded-full bg-brand-soft px-5 text-body font-semibold text-brand-primary" data-testid="member-offer-see">See offer</button>
      <button type="button" onClick={() => void notUseful()} className="flex h-11 items-center px-1 text-body text-ink-2" data-testid="member-offer-not-useful">Not useful</button>
    </div>
  )

  if (aiTopic) {
    return (
      <div ref={ref} className="rounded-[24px] border border-line bg-white p-3 shadow-[0_1px_2px_rgba(15,15,20,0.04)]" data-testid="member-offer-card" data-surface={surface}>
        <button type="button" onClick={open} className="flex w-full items-start gap-3 text-left">
          <OfferHero url={offer.image_url} className="h-16 w-16 shrink-0 rounded-[14px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-secondary font-semibold text-ink-2">From brands · {offer.brand_name}</span>
            <span className="mt-0.5 block text-body font-semibold leading-[22px] text-ink-1 line-clamp-2">{offer.title}</span>
            <span className="mt-0.5 block truncate text-row text-ink-2">{offer.body}</span>
          </span>
        </button>
        {reasonBox}
        {actions}
      </div>
    )
  }

  return (
    <div ref={ref} className="overflow-hidden rounded-[24px] border border-line bg-white" data-testid="member-offer-card" data-surface={surface}>
      {offer.image_url ? (
        <button type="button" onClick={open} className="relative block h-[130px] w-full" aria-label={`Open offer: ${offer.title}`}>
          <OfferHero url={offer.image_url} className="absolute inset-0 h-full w-full" />
          <span className="absolute left-3 top-3 rounded-full bg-black/35 px-2.5 py-1 text-secondary font-semibold text-white backdrop-blur-sm">From brands</span>
        </button>
      ) : null}
      <div className="p-4">
        {offer.image_url ? (
          <>
            <div className="flex items-center gap-2">
              <BrandLogo name={offer.brand_name} url={offer.brand_logo_url} className="h-[22px] w-[22px] rounded-[6px]" initialsClassName="text-[9px]" />
              <span className="truncate text-row text-ink-2">{offer.brand_name}</span>
            </div>
            <button type="button" onClick={open} className="mt-2 block text-left text-[17px] font-bold leading-[22px] text-ink-1 line-clamp-2">{offer.title}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={open} className="flex w-full items-start gap-3 text-left">
              <BrandLogo name={offer.brand_name} url={offer.brand_logo_url} className="h-10 w-10 shrink-0 rounded-[12px]" initialsClassName="text-[14px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-secondary font-semibold text-ink-2">From brands · {offer.brand_name}</span>
                <span className="mt-0.5 block text-[17px] font-bold leading-[22px] text-ink-1 line-clamp-2">{offer.title}</span>
              </span>
            </button>
            <p className="mt-2 text-row text-ink-2 line-clamp-2">{offer.body}</p>
          </>
        )}
        {reasonBox}
        {actions}
      </div>
    </div>
  )
}
