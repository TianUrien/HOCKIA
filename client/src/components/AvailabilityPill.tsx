import { Zap } from 'lucide-react'
import {
  availabilityDescriptor,
  type AvailabilityVariant,
  type AvailabilityRole,
  type AvailabilityFlags,
} from '@/lib/availabilityLabel'

type AvailabilitySize = 'sm' | 'md'

interface AvailabilityPillProps {
  variant: AvailabilityVariant
  /** Optional explicit label override; defaults to the canonical label. */
  label?: string
  size?: AvailabilitySize
  className?: string
}

// Per-variant styling. Labels come from availabilityLabel (single source of
// truth) unless an explicit `label` is passed.
// Rebrand PR 6: solid role tokens, no ad-hoc gradients.
const VARIANT_GRADIENT: Record<AvailabilityVariant, string> = {
  play: 'bg-status-positive', // available = positive (the one green)
  coach: 'bg-role-coach-ink',
  umpire: 'bg-role-umpire-ink',
  partnerships: 'bg-role-brand-ink',
  recruiting: 'bg-role-club-ink',
}
const VARIANT_LABEL: Record<AvailabilityVariant, string> = {
  play: 'Open to play',
  coach: 'Open to coach',
  umpire: 'Open to umpire',
  partnerships: 'Open to partnerships',
  recruiting: 'Recruiting',
}

/**
 * AvailabilityPill — the positive availability badge. ONLY positive,
 * role-specific labels (never a "not looking" state). Used on community
 * member cards, public profiles, dashboards, and search results.
 */
export default function AvailabilityPill({ variant, label, size = 'md', className = '' }: AvailabilityPillProps) {
  const text = label ?? VARIANT_LABEL[variant]
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'

  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        ${sizeClasses}
        rounded-full
        text-white font-medium
        ${VARIANT_GRADIENT[variant]}
        shadow-sm
        ${className}
      `}
    >
      <Zap className={iconSize} fill="currentColor" />
      {text}
    </span>
  )
}

interface ConditionalAvailabilityPillProps {
  /** Any of the 5 HOCKIA roles. */
  role: AvailabilityRole
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  open_to_opportunities?: boolean | null
  available_for_appointments?: boolean | null
  size?: AvailabilitySize
  className?: string
}

/**
 * Renders the role-specific positive availability pill, or nothing when the
 * member has no positive signal. Drives the label off the shared helper so
 * every surface reads identically.
 */
export function ConditionalAvailabilityPill({
  role,
  open_to_play,
  open_to_coach,
  open_to_opportunities,
  available_for_appointments,
  size = 'md',
  className = '',
}: ConditionalAvailabilityPillProps) {
  const flags: AvailabilityFlags = {
    open_to_play,
    open_to_coach,
    open_to_opportunities,
    available_for_appointments,
  }
  const desc = availabilityDescriptor(role, flags)
  if (!desc) return null
  return <AvailabilityPill variant={desc.variant} label={desc.label} size={size} className={className} />
}
