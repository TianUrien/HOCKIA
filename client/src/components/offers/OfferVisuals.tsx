import { cn } from '@/lib/utils'
import { initialsOf } from '@/lib/communityCard'
import { LogoTile } from '@/components/community/photo/LogoTile'

/** A brand's logo tile, or its initials in the brand-role ink (never a grey square). */
export function BrandLogo({ name, url, className, initialsClassName }: { name: string; url: string | null; className: string; initialsClassName?: string }) {
  if (url) return <LogoTile src={url} name={name} role="brand" className={cn('ring-1 ring-line', className)} initialsClassName={initialsClassName} />
  return (
    <span className={cn('flex items-center justify-center bg-white font-bold text-role-brand-ink ring-1 ring-line', className, initialsClassName)} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

/** The offer photo, or the brand gradient when there is none (never grey). */
export function OfferHero({ url, className }: { url: string | null; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={cn('object-cover', className)} />
  return <span className={cn('block bg-gradient-to-br from-brand-primary to-brand-primary-pressed', className)} aria-hidden="true" />
}
