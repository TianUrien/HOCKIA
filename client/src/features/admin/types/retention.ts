/**
 * Retention reporting types.
 *
 * These mirror the payloads of the SQL retention service
 * (supabase/migrations/20260827100000_retention_service_d7_d15_d30.sql).
 * The percentages are computed in Postgres from one shared definition — the
 * client only formats them, so a card and the cohort grid can never disagree.
 */

/** How a return is counted. Labels are shown to admins verbatim. */
export type RetentionMethod = 'bracket' | 'on' | 'on_or_after'

/** What counts as a return. */
export type RetentionActivity = 'any' | 'meaningful'

export type RetentionGrain = 'week' | 'month'

export const RETENTION_METHOD_LABEL: Record<RetentionMethod, string> = {
  bracket: 'Returned that week (days N–N+6)',
  on: 'Return On (exactly day N)',
  on_or_after: 'Return On or After (day N or later)',
}

export const RETENTION_ACTIVITY_LABEL: Record<RetentionActivity, string> = {
  any: 'Any active return',
  meaningful: 'Meaningful activity',
}

/** Below this many eligible members a percentage is real but noisy. */
export const MIN_CONFIDENT_ELIGIBLE = 20

export interface RetentionCheckpoint {
  day: number
  /** Everyone in the signup period, eligible or not. */
  cohort_size: number
  /** Members whose Day-N window has fully elapsed — the denominator. */
  eligible: number
  /** Eligible members who returned — the numerator. */
  retained: number
  /** null when `eligible` is 0: not enough eligible data, NOT zero percent. */
  pct: number | null
  prev_eligible: number
  prev_retained: number
  prev_pct: number | null
  /** Percentage points vs the preceding equal-length signup period. */
  delta_pts: number | null
}

export interface RetentionSummary {
  method: RetentionMethod
  activity: RetentionActivity
  timezone: string
  period_days: number
  cohort_from: string
  cohort_to: string
  generated_at: string
  checkpoints: RetentionCheckpoint[]
}

export interface RetentionCohortCell {
  day: number
  eligible: number
  retained: number
  pct: number | null
}

export interface RetentionCohortRow {
  cohort_start: string
  cohort_size: number
  cells: RetentionCohortCell[]
}

export interface RetentionCohortTable {
  method: RetentionMethod
  activity: RetentionActivity
  grain: RetentionGrain
  timezone: string
  cohort_from: string
  cohort_to: string
  days: number[]
  generated_at: string
  rows: RetentionCohortRow[]
}

export interface RetentionFilterOptions {
  roles: string[]
  countries: { id: number; name: string }[]
  platforms: string[]
  sources: string[]
}

/** Filters shared by the summary cards and the cohort grid. */
export interface RetentionFilters {
  role?: string | null
  countryId?: number | null
  platform?: string | null
  source?: string | null
}
