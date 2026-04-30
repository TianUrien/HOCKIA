import { Shield, ArrowRight } from 'lucide-react'
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
 * Phase 4 References UX Plan — Phase 1.1.
 *
 * Surfaces the trust signal in profile headers — the single highest-impact
 * placement for discoverability per the deep audit. Three render states:
 *
 *   1. count > 0  → "Trusted by N" pill (emerald). Tappable; visitors and
 *                   owners both navigate to the references view.
 *   2. count = 0 + isOwner → "Get vouches →" CTA (HOCKIA primary purple).
 *                            Drives the owner toward the trust subarea
 *                            with explicit forward affordance.
 *   3. count = 0 + visitor → renders nothing. No need to advertise the
 *                            empty state to scouts.
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
  if (count === 0 && !isOwner) return null

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

  const label = hasReferences
    ? `Trusted by ${count}`
    : 'Get vouches'

  const tooltip = hasReferences
    ? `${count} ${count === 1 ? 'person has' : 'people have'} vouched for you on HOCKIA. Tap to see endorsements.`
    : 'Get your first reference and clubs can verify your hockey. Tap to ask a connection.'

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
        className,
      )}
    >
      <Shield className={iconSize} aria-hidden="true" />
      {label}
      {!hasReferences && <ArrowRight className={iconSize} aria-hidden="true" />}
    </button>
  )
}
