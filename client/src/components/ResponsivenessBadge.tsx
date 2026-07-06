/**
 * Public responsiveness badge (Task 2) — Airbnb-host-style positive social
 * pressure. A REWARD to earn, never a punishment: publishers with no data,
 * too few samples (<3), or slow medians simply have NO badge (the daily
 * snapshot leaves tier NULL / no row), so this component renders nothing.
 *
 * Tiers come precomputed from publisher_responsiveness (daily snapshot;
 * median first-response time, post-launch applications only, auto-expiries
 * counted — the teeth that make the badge honest).
 */
import { Zap, Clock } from 'lucide-react'

export type ResponsivenessTier = 'fast' | 'week' | 'two_weeks'

const TIER_COPY: Record<ResponsivenessTier, { label: string; className: string; icon: typeof Zap }> = {
  fast: {
    label: 'Responds within ~3 days',
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
    icon: Zap,
  },
  week: {
    label: 'Responds within ~1 week',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: Clock,
  },
  two_weeks: {
    label: 'Responds within ~2 weeks',
    className: 'bg-gray-50 text-gray-600 ring-gray-200',
    icon: Clock,
  },
}

export default function ResponsivenessBadge({
  tier,
  className = '',
}: {
  tier: ResponsivenessTier | null | undefined
  className?: string
}) {
  if (!tier || !(tier in TIER_COPY)) return null
  const { label, className: tierClass, icon: Icon } = TIER_COPY[tier]
  return (
    <span
      data-testid="responsiveness-badge"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tierClass} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
