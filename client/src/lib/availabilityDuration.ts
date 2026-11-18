/**
 * profiles.availability_duration vocabulary (chk_availability_duration).
 * Pure module — safe to import from tests without Supabase env vars.
 */
import { tProfileEdit } from '@/i18n/ns/profileEdit'
import { lazyTextRecord } from '@/lib/opportunityLazyText'

export const AVAILABILITY_DURATIONS = ['full_season', 'half_season', 'short_term', 'flexible'] as const
export type AvailabilityDuration = (typeof AVAILABILITY_DURATIONS)[number]

/** Labels are read in the interface language each time they are used. */
export const AVAILABILITY_DURATION_LABELS: Record<AvailabilityDuration, string> = lazyTextRecord({
  full_season: () => tProfileEdit('availability.duration.fullSeason'),
  half_season: () => tProfileEdit('availability.duration.halfSeason'),
  short_term: () => tProfileEdit('availability.duration.shortTerm'),
  flexible: () => tProfileEdit('availability.duration.flexible'),
})

export function isAvailabilityDuration(value: unknown): value is AvailabilityDuration {
  return typeof value === 'string' && (AVAILABILITY_DURATIONS as readonly string[]).includes(value)
}
