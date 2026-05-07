import { useEffect, useRef, useState } from 'react'
import { Shield, ArrowRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TrustBadgeProps {
  /** Number of accepted references (denormalized profiles.accepted_reference_count). */
  count: number
  /** True when the dashboard owner is viewing their own profile. Drives the
   *  empty-state copy: visitors see nothing on a 0-references profile, owners
   *  see a CTA pill nudging them toward the trust subarea. */
  isOwner: boolean
  /** Click handler. The owner case scrolls / navigates to the trust subarea
   *  inside the Friends tab; the visitor case scrolls to the public references
   *  section in the current page. */
  onClick?: () => void
  /** Compact sizing for crowded headers. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Surfaces the trust signal in profile headers — the single highest-impact
 * placement for discoverability per the deep audit. Two render states:
 *
 *   1. count > 0  → "Trusted by N" pill (emerald). Tappable; visitors and
 *                   owners both navigate to the references view.
 *   2. count = 0  → renders nothing. The reference CTA lives in
 *                   NextStepCard and RecentlyConnectedCard further down
 *                   the dashboard; an empty-state pill in the header
 *                   stacks redundantly on top of those.
 *
 * Visual treatment mirrors TierBadge / VerifiedBadge for consistency.
 * Always renders as a `<button>` when clickable so keyboard nav + a11y
 * work for free.
 */
export default function TrustBadge({
  count,
  isOwner,
  onClick,
  size = 'md',
  className,
}: TrustBadgeProps) {
  // Hide the empty-state CTA pill entirely. NextStepCard and
  // RecentlyConnectedCard handle the "get your first reference" prompt
  // with stronger visual treatment; this header pill was a third
  // duplicate ask on the same screen. `isOwner` is kept on the props
  // shape (call sites still pass it) but no longer changes behaviour.
  void isOwner
  if (count === 0) return null

  const hasReferences = count > 0
  const sizing =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] gap-1'
      : 'px-2.5 py-1 text-xs gap-1.5'
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'

  // Variant styling. The CTA variant is a deliberate brand-purple to read as
  // "do this next"; the positive variant uses emerald to match HOCKIA's other
  // accepted-state signals (per the audit's bug-fix where possible_match was
  // moved off amber to avoid the references-shield collision).
  const variantClasses = hasReferences
    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    : 'bg-[#8026FA]/10 text-[#8026FA] hover:bg-[#8026FA]/15 border border-[#8026FA]/20'

  // Standardise on "references" as the noun (consistent with the rest of
  // the app) and keep "vouch" as the verb. The empty-owner label is
  // self-explanatory enough that mobile users who never see a title=
  // tooltip still understand the affordance — important because Capacitor
  // / iOS Safari do not render `title` on tap.
  const label = hasReferences
    ? `Trusted by ${count}`
    : 'Get references'

  const tooltip = hasReferences
    ? `${count} ${count === 1 ? 'person has' : 'people have'} vouched for you on HOCKIA. Tap to see endorsements.`
    : 'References are vouches from coaches, teammates or clubs you\'re connected with. Tap to ask a connection.'

  // Always render as a button when clickable; falls back to span when no
  // onClick is wired (defensive — should not happen in current usage).
  if (!onClick) {
    return (
      <span
        className={cn('inline-flex items-center rounded-full font-medium', sizing, variantClasses, className)}
        title={tooltip}
        aria-label={tooltip}
      >
        <Shield className={iconSize} aria-hidden="true" />
        {label}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        aria-label={tooltip}
        className={cn(
          'inline-flex items-center rounded-full font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
          sizing,
          variantClasses,
        )}
      >
        <Shield className={iconSize} aria-hidden="true" />
        {label}
        {!hasReferences && <ArrowRight className={iconSize} aria-hidden="true" />}
      </button>
      {hasReferences && <TrustBadgeInfoButton tooltip={tooltip} size={size} />}
    </span>
  )
}

/**
 * Companion "?" info button for the "Trusted by N" badge. Native HTML
 * `title=` doesn't render on tap on iOS Safari / Capacitor WKWebView, so
 * mobile users have no way to learn what the badge means. This sibling
 * button toggles a small popover on tap (and on hover via the same `title`).
 */
function TrustBadgeInfoButton({ tooltip, size }: { tooltip: string; size: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label="What does this mean?"
        aria-expanded={open ? 'true' : 'false'}
        title="What does Trusted mean?"
        className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40"
      >
        <Info className={iconSize} aria-hidden="true" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-64 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
        >
          {tooltip}
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900" aria-hidden="true" />
        </span>
      )}
    </span>
  )
}
