/**
 * profiles.availability_duration vocabulary (chk_availability_duration).
 * Pure module — safe to import from tests without Supabase env vars.
 */
export const AVAILABILITY_DURATIONS = ['full_season', 'half_season', 'short_term', 'flexible'] as const
export type AvailabilityDuration = (typeof AVAILABILITY_DURATIONS)[number]

export const AVAILABILITY_DURATION_LABELS: Record<AvailabilityDuration, string> = {
  full_season: 'Full season',
  half_season: 'Half season',
  short_term: 'Short term',
  flexible: 'Flexible',
}

export function isAvailabilityDuration(value: unknown): value is AvailabilityDuration {
  return typeof value === 'string' && (AVAILABILITY_DURATIONS as readonly string[]).includes(value)
}
