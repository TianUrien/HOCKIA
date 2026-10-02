import { cn } from '@/lib/utils'

/**
 * The mark on a career entry that confirm_signing created
 * (career_history.signed_via_hockia — the server sets it, clients never
 * can). Same look everywhere it renders: the signed screen (D4.6), the
 * profile's Career section, See all, the entry detail, the desktop
 * Journey card and every club / public view of the career.
 */
export function SignedThroughHockiaPill({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 rounded-full bg-hockia-soft px-2 py-0.5 text-caption font-semibold text-hockia-primary', className)}
      data-testid="signed-through-hockia"
    >
      Signed through Hockia
    </span>
  )
}
