import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VerifiedBadgeProps {
  /** Whether the owner / brand is verified. Render nothing when false. */
  verified: boolean | null | undefined
  /**
   * ISO timestamp when the current verification was granted. Included in
   * the hover/long-press tooltip when provided.
   */
  verifiedAt?: string | null
  /** Compact sizing for dense rows like MemberCard. */
  size?: 'sm' | 'md'
  className?: string
}

function formatGrantedDate(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

/**
 * Small blue checkmark shown next to a profile's name when an admin has
 * granted verification. Icon-only by design: matches the familiar social
 * convention, stays readable in the crowded MemberCard badge row, and fits
 * the profile header without layout changes. The tooltip uses a native
 * `title` attribute — good enough for this one-liner and avoids reaching
 * for InfoTooltip whose trigger is locked to the Info icon.
 *
 * Role-agnostic: brand verification still lives on `brands.is_verified`;
 * callers pass the right source via `verified`.
 */
export default function VerifiedBadge({
  verified,
  verifiedAt,
  size = 'md',
  className,
}: VerifiedBadgeProps) {
  if (!verified) return null

  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const grantedLabel = verifiedAt ? formatGrantedDate(verifiedAt) : ''
  const tooltip = grantedLabel
    ? `Verified by HOCKIA — ${grantedLabel}`
    : 'Verified by HOCKIA'

  return (
    <span
      className={cn('inline-flex items-center text-blue-500', className)}
      role="img"
      aria-label="Verified profile"
      title={tooltip}
    >
      <BadgeCheck className={iconClass} aria-hidden="true" />
    </span>
  )
}
