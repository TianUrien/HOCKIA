import { Info, MoreHorizontal, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  audienceLine,
  offerPill,
  offerReasonLine,
  offerShownFields,
  offerStatusLine,
  type BrandOffer,
  type OfferFields,
  type OfferPillTone,
} from '@/lib/brandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'

/**
 * Shared pieces of the brand Offers screens (Figma "08 · Brands", P1: B1 rows,
 * B2 / D1 member preview, A1 admin preview).
 */

const PILL_TONE: Record<OfferPillTone, string> = {
  positive: 'bg-status-positive-soft text-status-positive',
  amber: 'bg-status-warning-soft text-status-warning',
  neutral: 'bg-surface-muted text-ink-1',
  muted: 'bg-surface-muted text-ink-2',
}

export function OfferPill({ offer }: { offer: Pick<BrandOffer, 'status' | 'pending_status'> }) {
  const pill = offerPill(offer)
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-secondary font-semibold', PILL_TONE[pill.tone])}>
      {pill.label}
    </span>
  )
}

/** Offer photo, or the brand-violet tile when there is none (never grey). */
export function OfferThumb({ url, className }: { url: string | null; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={cn('object-cover', className)} />
  return (
    <span className={cn('flex items-center justify-center bg-brand-soft text-brand-primary', className)} aria-hidden="true">
      <Tag className="h-6 w-6" strokeWidth={1.8} />
    </span>
  )
}

interface OfferRowProps {
  offer: BrandOffer
  onOpen: () => void
  onMenu: () => void
  selected?: boolean
}

/** One offer in the brand's list (Figma B1 row card). */
export function OfferRow({ offer, onOpen, onMenu, selected = false }: OfferRowProps) {
  const names = useCountryNames()
  const shown = offerShownFields(offer)
  return (
    <div
      className={cn('rounded-[24px] bg-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.06)]', selected && 'ring-2 ring-brand-primary')}
      data-testid="offer-row"
    >
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <OfferThumb url={shown.image_url} className="h-14 w-14 shrink-0 rounded-[14px]" />
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block truncate text-body font-semibold text-ink-1">{shown.title || 'Untitled offer'}</span>
            <span className="mt-0.5 block text-row text-ink-2">{audienceLine(names(shown.country_ids), shown.roles) || 'No audience yet'}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onMenu}
          aria-label={`Actions for ${shown.title || 'offer'}`}
          className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 active:bg-surface-muted"
          data-testid="offer-row-menu"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 flex items-start gap-2.5">
        <OfferPill offer={offer} />
        <p className="min-w-0 flex-1 pt-0.5 text-secondary text-ink-2">{offerStatusLine(offer)}</p>
      </div>
    </div>
  )
}

interface OfferPreviewCardProps {
  fields: OfferFields
  brandName: string
  /** Country and role the preview reads for ("You see this because…"). */
  reasonCountry?: string | null
  reasonRole?: string | null
  className?: string
}

/**
 * The offer as a member sees it (Figma B2 "How members see it"): "From
 * brands" label on the photo, the reason line (location and role only, never
 * nationality), See offer and Not useful. Inert here: it is a preview.
 */
export function OfferPreviewCard({ fields, brandName, reasonCountry, reasonRole, className }: OfferPreviewCardProps) {
  return (
    <div className={cn('overflow-hidden rounded-[24px] bg-white shadow-[0_1px_3px_rgba(15,15,20,0.08)]', className)} data-testid="offer-preview">
      <div className="relative aspect-[16/9] w-full">
        <OfferThumb url={fields.image_url} className="absolute inset-0 h-full w-full" />
        <span className="absolute left-3 top-3 rounded-full bg-black/35 px-2.5 py-1 text-secondary font-semibold text-white backdrop-blur-sm">From brands</span>
      </div>
      <div className="p-4">
        <p className="text-secondary text-ink-2">{brandName}</p>
        <p className="mt-0.5 text-body font-semibold text-ink-1">{fields.title?.trim() || 'Your title'}</p>
        <p className="mt-1 text-row text-ink-2">{fields.body?.trim() || 'What members get'}</p>
        <p className="mt-3 flex gap-2 rounded-[14px] bg-surface-subtle p-3 text-secondary text-ink-2">
          <Info className="mt-px h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
          {offerReasonLine(reasonCountry ?? null, reasonRole)}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex h-9 items-center rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary">See offer</span>
          <span className="text-row text-ink-2">Not useful</span>
        </div>
      </div>
    </div>
  )
}
