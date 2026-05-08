import { useAuthStore } from '@/lib/auth'

interface LastActivePillProps {
  /** ISO timestamp of profiles.last_active_at, or null/undefined if never seen. */
  lastActiveAt: string | null | undefined
  /** Optional className for layout integration. */
  className?: string
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * LastActivePill — a small "Active <bucket>" indicator on public profile
 * headers. Helps recruiters distinguish between fresh profiles and stale
 * ones at a glance.
 *
 * Privacy contract (v1):
 *   - **Auth-only**: renders nothing for anonymous visitors. The
 *     last_active_at column is denormalized on profiles and would be
 *     readable by anon SELECT, but we choose not to surface it in the
 *     UI to anonymous viewers — recruiters get the signal they need
 *     (they are authenticated), anonymous scrapers don't.
 *   - **Bucketed**: only ever shows one of "Active today / Active this
 *     week / Active this month". No exact timestamps, no "X minutes
 *     ago" — too easy to read as creep tracking.
 *   - **Silent on stale profiles**: > 30 days inactive renders nothing
 *     instead of a "Last seen 6 months ago" stigma label. Absence of
 *     pill = no recent activity = recruiters can infer staleness from
 *     other signals (Profile Snapshot, content updates).
 *   - **No opt-out yet (v1)**: a per-user `show_last_active` toggle
 *     would need a DB migration + Settings surface; deferred to a
 *     follow-up if any user feedback requests it. The auth-only gate
 *     is the privacy floor for now.
 *
 * This component is intentionally small and self-contained — drop it
 * into any profile header next to TierBadge / VerifiedBadge.
 */
export default function LastActivePill({ lastActiveAt, className }: LastActivePillProps) {
  const viewer = useAuthStore((s) => s.user)

  // Anon-gate: never expose presence to logged-out viewers.
  if (!viewer) return null
  if (!lastActiveAt) return null

  const ms = Date.now() - new Date(lastActiveAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return null

  // Bucket selection. Order matters — earliest match wins.
  let label: string
  if (ms < DAY_MS) {
    label = 'Active today'
  } else if (ms < 7 * DAY_MS) {
    label = 'Active this week'
  } else if (ms < 30 * DAY_MS) {
    label = 'Active this month'
  } else {
    // >30 days — silent. No pill = no claim.
    return null
  }

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        'bg-emerald-50 text-emerald-700',
        className ?? '',
      ].join(' ')}
      // Title gives the exact bucket on hover for keyboard / screen-reader
      // users without exposing a precise timestamp anywhere.
      title={label}
      aria-label={label}
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-emerald-500"
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
