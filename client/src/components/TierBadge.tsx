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
  // Phase 1A.1 (v5 plan) — labels rebranded from quality-implying words
  // (Rookie/Active/Rising/Elite) to neutral profile-completeness words.
  // The underlying ProfileTier enum + thresholds in profileTier.ts are
  // unchanged so sort/filter behavior is preserved; only the visible
  // label moves. Internal tier keys (rookie/active/rising/elite) stay
  // for back-compat with existing tests + community-grid sort.
  rookie: {
    label: 'Just started',
    icon: Sprout,
    classes: 'bg-gray-100 text-gray-600',
  },
  active: {
    label: 'Getting there',
    icon: TrendingUp,
    classes: 'bg-blue-50 text-blue-700',
  },
  rising: {
    label: 'Looking good',
    icon: Sparkles,
    classes: 'bg-amber-50 text-amber-700',
  },
  elite: {
    // Renamed from "All set" — that label implied the profile was 100%
    // complete, but the underlying tier fires at >=90% strength and the
    // references bucket gives full credit at count >= 1, so a player
    // with 1/5 references could already see "All set". "Strong profile"
    // describes the state without claiming everything is done.
    label: 'Strong profile',
    icon: CheckCircle2,
    classes: 'bg-emerald-50 text-emerald-700',
  },
}

/**
 * Visual indicator of profile completeness — describes the state of the
 * profile, not the person. Labels: Just started → Getting there →
 * Looking good → All set. Positive framing: lower bands get neutral
 * tones rather than warning colors so that early profiles feel
 * welcomed, not shamed.
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
      aria-label={`Profile completeness: ${label}`}
    >
      <Icon className={iconSize} aria-hidden="true" />
      {label}
    </span>
  )
}
