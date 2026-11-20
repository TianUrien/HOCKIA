import { cn } from '@/lib/utils'
import { LogoTile } from '@/components/community/photo/LogoTile'
import RolePlaceholder from '@/components/RolePlaceholder'
import { ORG_SHAPE } from '@/lib/orgImage'

/**
 * A brand's logo tile, or the brand Avatar / Placeholder (never initials).
 * `className` gives the size and shadow; the shape is always the organisation
 * rounded square, so a radius passed by an older caller is dropped.
 */
export function BrandLogo({ name, url, className, eager }: { name: string; url: string | null; className: string; initialsClassName?: string; eager?: boolean }) {
  const box = className.replace(/(^|\s)rounded-\S+/g, ' ').trim()
  if (url) return <LogoTile src={url} name={name} role="brand" eager={eager} className={box} />
  return (
    <span className={cn('block overflow-hidden', ORG_SHAPE, box)} aria-hidden="true">
      <RolePlaceholder role="brand" label="" />
    </span>
  )
}

/** The offer photo, or the brand gradient when there is none (never grey). */
export function OfferHero({ url, className }: { url: string | null; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={cn('object-cover', className)} />
  return <span className={cn('block bg-gradient-to-br from-brand-primary to-brand-primary-pressed', className)} aria-hidden="true" />
}

/** The offer's perk ("15% off") as a small pill; falls back to "Offer" (2026-11-07). */
export function PerkPill({ perk, className }: { perk?: string | null; className?: string }) {
  const text = (perk ?? '').trim() || 'Offer'
  return <span className={className ?? 'rounded-full bg-white px-2 py-0.5 text-caption font-semibold text-brand-primary'} data-testid="offer-perk">{text}</span>
}
