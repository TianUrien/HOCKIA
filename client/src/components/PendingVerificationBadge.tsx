import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PendingVerificationBadgeProps {
  /** Whether the club has been verified by HOCKIA admin. */
  verified: boolean | null | undefined
  /** Optional className override. */
  className?: string
  /** Compact (icon-only) vs full (icon + text) display. */
  variant?: 'full' | 'compact'
}

/**
 * PendingVerificationBadge — soft trust signal for unverified clubs.
 *
 * Companion to VerifiedBadge. Renders nothing when the club IS verified
 * (VerifiedBadge takes over). Renders a muted "Pending verification"
 * pill when verified is false/null, so visitors of a freshly-claimed
 * (or impersonated) club page see clearly that the claim hasn't been
 * vetted by HOCKIA admin yet.
 *
 * Pre-launch context: the world_clubs claim flow doesn't require
 * upstream verification, so any user could in principle claim any
 * club. This badge shifts the trust signal from "claim happened" to
 * "claim has been reviewed" — visitors weight unverified profiles
 * accordingly. Admin grants verification via the existing
 * admin_set_profile_verified RPC; this is the visitor-facing surface.
 */
export default function PendingVerificationBadge({
  verified,
  className,
  variant = 'full',
}: PendingVerificationBadgeProps) {
  // VerifiedBadge handles the verified=true state; this is purely the
  // "not yet verified" signal.
  if (verified) return null

  const tooltip = "HOCKIA hasn't verified this club's claim yet."

  return (
    <span
      role="img"
      aria-label="Pending verification"
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700',
        variant === 'compact' ? 'px-1.5 py-0.5' : 'px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      <ShieldAlert className={variant === 'compact' ? 'h-3 w-3' : 'h-3 w-3'} aria-hidden="true" />
      {variant === 'full' && <span>Pending verification</span>}
    </span>
  )
}
