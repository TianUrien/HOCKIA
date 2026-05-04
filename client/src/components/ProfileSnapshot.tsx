import { useMemo } from 'react'
import {
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react'
import type { Profile } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  computeSignals,
  getOwnerSubtitle,
  type ProfileSnapshotBrandFields,
  type ProfileSnapshotMode,
  type ProfileSnapshotSignal,
} from '@/lib/profileSnapshotSignals'

/**
 * Profile Snapshot — the canonical "what people see" surface for every role.
 *
 * Owner mode (mode='owner'): full signal list with ✓ for present and a
 * neutral – for missing. Missing items expose a small action button that
 * dispatches an actionId to the parent (the parent owns the modal/tab
 * routing — same dispatcher pattern as NextStepCard).
 *
 * Public mode (mode='public'): only present (✓) signals are rendered —
 * never publicly draw negative attention to what's missing. If no signals
 * are present, the entire block hides (no zero state on a public profile).
 *
 * The component is intentionally NOT a score. It is a list of concrete
 * signals visible on the profile — references, video, club affiliation,
 * etc. The internal Tier % stays internal; this surface answers "what's
 * there" rather than "how complete." Per the v5 plan's reframe: the
 * Profile Snapshot is the Clarity-Layer artifact for every role.
 *
 * Signal-computation logic + types live in `@/lib/profileSnapshotSignals`
 * so this file stays a clean React-component module (Vite's react-refresh
 * disallows non-component named exports in TSX).
 */

interface ProfileSnapshotProps {
  profile: Profile | null
  /** Brand-only: brand entity fields. Required when role is brand. */
  brand?: ProfileSnapshotBrandFields | null
  /** Brand-only: products count (passed in by BrandDashboard / BrandProfilePage to avoid a duplicate fetch here). */
  brandProductCount?: number
  /** Brand-only: ambassadors count (same rationale). */
  brandAmbassadorCount?: number
  /** Brand-only: posts count. */
  brandPostCount?: number
  /** Drives ✓-only filtering + the missing-item action affordance. */
  mode: ProfileSnapshotMode
  /** Owner-mode: invoked when the owner taps a missing signal. */
  onSignalAction?: (actionId: string) => void
  /** Optional className to align with the surrounding layout. */
  className?: string
}

export default function ProfileSnapshot({
  profile,
  brand = null,
  brandProductCount = 0,
  brandAmbassadorCount = 0,
  brandPostCount = 0,
  mode,
  onSignalAction,
  className,
}: ProfileSnapshotProps) {
  const allSignals = useMemo(
    () =>
      profile
        ? computeSignals(profile, brand, brandProductCount, brandAmbassadorCount, brandPostCount)
        : [],
    [profile, brand, brandProductCount, brandAmbassadorCount, brandPostCount],
  )

  if (!profile) return null
  if (allSignals.length === 0) return null

  // Public mode: drop missing signals entirely. Never publicly highlight gaps.
  const visibleSignals = mode === 'public' ? allSignals.filter((s) => s.present) : allSignals

  // Public mode + nothing to show → render nothing (no empty state).
  if (mode === 'public' && visibleSignals.length === 0) return null

  const presentCount = allSignals.filter((s) => s.present).length
  const totalCount = allSignals.length

  return (
    <section
      className={cn(
        'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm',
        className,
      )}
      aria-label="Profile Snapshot"
    >
      <header className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-base font-semibold text-gray-900">Profile Snapshot</h3>
          {mode === 'owner' && (
            <span className="text-xs font-medium text-gray-500 tabular-nums">
              {presentCount} of {totalCount}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {mode === 'owner'
            ? getOwnerSubtitle(profile.role, profile.coach_recruits_for_team ?? false)
            : 'Highlights from this profile'}
        </p>
      </header>

      <ul className="space-y-2">
        {visibleSignals.map((signal) => (
          <SignalRow
            key={signal.id}
            signal={signal}
            mode={mode}
            onAction={onSignalAction}
          />
        ))}
      </ul>
    </section>
  )
}

// ============================================================================
// Single-row renderer
// ============================================================================

interface SignalRowProps {
  signal: ProfileSnapshotSignal
  mode: ProfileSnapshotMode
  onAction?: (actionId: string) => void
}

function SignalRow({ signal, mode, onAction }: SignalRowProps) {
  const isMissing = !signal.present
  const canAct = mode === 'owner' && isMissing && Boolean(signal.ownerActionId) && Boolean(onAction)

  const Icon = signal.present ? CheckCircle2 : Circle
  const iconClass = signal.present ? 'text-emerald-500' : 'text-gray-300'

  const handleClick = () => {
    if (!canAct || !onAction || !signal.ownerActionId) return
    onAction(signal.ownerActionId)
  }

  const content = (
    <>
      <Icon className={cn('w-4 h-4 flex-shrink-0', iconClass)} aria-hidden="true" />
      <span
        className={cn(
          'flex-1 text-sm',
          signal.present ? 'text-gray-800' : 'text-gray-500',
        )}
      >
        {signal.label}
        {signal.detail && (
          <span className="ml-1.5 text-xs text-gray-400">({signal.detail})</span>
        )}
      </span>
      {canAct && (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[#8026FA]">
          Add
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </span>
      )}
    </>
  )

  if (canAct) {
    return (
      <li>
        <button
          type="button"
          onClick={handleClick}
          className="w-full flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
        >
          {content}
        </button>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 px-2 py-1.5 -mx-2">
      {content}
    </li>
  )
}
