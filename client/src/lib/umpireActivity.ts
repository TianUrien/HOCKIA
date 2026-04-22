/**
 * Derives the "last officiated" activity signal from profiles.last_officiated_at
 * (denormalized MAX over umpire_appointments; see migration 20260422130000).
 *
 * Three rendered states:
 *   - active   → within the last ~6 months → "Active this season"
 *   - recent   → 6 – 24 months ago           → "Last officiated: Mar 2026"
 *   - distant  → older than 24 months        → "Last officiated: 2024"
 *   - null     → no dated appointments       → don't render the pill at all
 *
 * "This season" maps to 6 months because field hockey leagues typically
 * span a single calendar half — an umpire who officiated in the last half
 * is actively on a panel somewhere.
 */

export type UmpireActivityState = 'active' | 'recent' | 'distant'

export interface UmpireActivity {
  state: UmpireActivityState
  /** Human-readable label suitable for pill text */
  label: string
}

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000
const TWENTY_FOUR_MONTHS_MS = 24 * 30 * 24 * 60 * 60 * 1000

export function getUmpireActivity(
  lastOfficiatedAt: string | null | undefined,
  now: Date = new Date()
): UmpireActivity | null {
  if (!lastOfficiatedAt) return null

  // Dates come back from Supabase as 'YYYY-MM-DD'. Parse at UTC midnight so
  // we don't drift a day depending on the viewer's timezone.
  const date = new Date(lastOfficiatedAt + 'T00:00:00Z')
  if (Number.isNaN(date.getTime())) return null

  const ageMs = now.getTime() - date.getTime()

  if (ageMs <= SIX_MONTHS_MS) {
    return { state: 'active', label: 'Active this season' }
  }

  if (ageMs <= TWENTY_FOUR_MONTHS_MS) {
    return {
      state: 'recent',
      label: `Last officiated: ${date.toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })}`,
    }
  }

  return {
    state: 'distant',
    label: `Last officiated: ${date.getUTCFullYear()}`,
  }
}
