import { cn } from '@/lib/utils'
import { LogoTile } from '@/components/community/photo/LogoTile'
import RolePlaceholder from '@/components/RolePlaceholder'

/** A brand's logo tile, or the brand Avatar / Placeholder (never initials). */
export function BrandLogo({ name, url, className, initialsClassName, eager }: { name: string; url: string | null; className: string; initialsClassName?: string; eager?: boolean }) {
  if (url) return <LogoTile src={url} name={name} role="brand" eager={eager} className={cn('ring-1 ring-line', className)} initialsClassName={initialsClassName} />
  return (
    <span className={cn('block overflow-hidden', className)} aria-hidden="true">
      <RolePlaceholder role="brand" label="" />
    </span>
  )
}

/** The offer photo, or the brand gradient when there is none (never grey). */
export function OfferHero({ url, className }: { url: string | null; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={cn('object-cover', className)} />
  return <span className={cn('block bg-gradient-to-br from-brand-primary to-brand-primary-pressed', className)} aria-hidden="true" />
}
