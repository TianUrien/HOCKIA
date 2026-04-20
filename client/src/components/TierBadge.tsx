import { Sparkles, TrendingUp, CheckCircle2, Sprout } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProfileTier } from '@/lib/profileTier'

type TierBadgeProps = {
  tier: ProfileTier
  /** Compact variant for dense rows like MemberCard — slightly smaller text, tighter padding. */
  size?: 'sm' | 'md'
  className?: string
}

const tierStyles: Record<ProfileTier, { label: string; icon: typeof Sparkles; classes: string }> = {
  rookie: {
    label: 'Rookie',
    icon: Sprout,
    classes: 'bg-gray-100 text-gray-600',
  },
  active: {
    label: 'Active',
    icon: TrendingUp,
    classes: 'bg-blue-50 text-blue-700',
  },
  rising: {
    label: 'Rising',
    icon: Sparkles,
    classes: 'bg-amber-50 text-amber-700',
  },
  elite: {
    label: 'Elite',
    icon: CheckCircle2,
    classes: 'bg-emerald-50 text-emerald-700',
  },
}

/**
 * Visual tier indicator for a profile — Rookie → Active → Rising → Elite,
 * derived client-side from profile-strength percentage. Positive framing:
 * lower tiers get neutral tones rather than warning colors so that early
 * profiles feel welcomed, not shamed.
 *
 * Verified-style trust badges are a separate, admin-granted concept.
 */
export default function TierBadge({ tier, size = 'md', className }: TierBadgeProps) {
  const { label, icon: Icon, classes } = tierStyles[tier]
  const sizing =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] gap-1'
      : 'px-2.5 py-1 text-xs gap-1.5'
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'

  return (
    <span
      className={cn('inline-flex items-center rounded-full font-medium', sizing, classes, className)}
      aria-label={`Profile tier: ${label}`}
    >
      <Icon className={iconSize} aria-hidden="true" />
      {label}
    </span>
  )
}
