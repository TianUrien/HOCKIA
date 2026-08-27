/**
 * Retention API — thin wrappers over the SQL retention service.
 *
 * Every number shown anywhere in the Admin Portal comes from these calls, so
 * the summary cards, the cohort grid and the CSV export are the same
 * arithmetic. Nothing is computed client-side beyond formatting.
 */

import { supabase } from '@/lib/supabase'
import { DEFAULT_RETENTION_DAYS, retentionFilterParams } from '../lib/retentionFilters'
import type {
  RetentionActivity,
  RetentionCohortTable,
  RetentionFilterOptions,
  RetentionFilters,
  RetentionGrain,
  RetentionMethod,
  RetentionSummary,
} from '../types/retention'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

// Defined in lib/retentionFilters (no Supabase import) so tests can exercise
// the mapping without env vars; re-exported here for callers.
export { DEFAULT_RETENTION_DAYS, retentionFilterParams }

export interface RetentionQuery extends RetentionFilters {
  days?: number[]
  activity?: RetentionActivity
  method?: RetentionMethod
}

export async function getRetentionSummary(
  query: RetentionQuery & { periodDays?: number } = {},
): Promise<RetentionSummary> {
  const { data, error } = await adminRpc('admin_get_retention_summary', {
    p_days: query.days ?? DEFAULT_RETENTION_DAYS,
    p_activity: query.activity ?? 'any',
    p_method: query.method ?? 'bracket',
    p_period_days: query.periodDays ?? 90,
    ...retentionFilterParams(query),
  })
  if (error) throw new Error(`Failed to get retention summary: ${error.message}`)
  return data as RetentionSummary
}

export async function getRetentionCohortTable(
  query: RetentionQuery & { grain?: RetentionGrain; from?: string | null; to?: string | null } = {},
): Promise<RetentionCohortTable> {
  const { data, error } = await adminRpc('admin_get_retention_cohort_table', {
    p_days: query.days ?? DEFAULT_RETENTION_DAYS,
    p_activity: query.activity ?? 'any',
    p_method: query.method ?? 'bracket',
    p_grain: query.grain ?? 'week',
    p_cohort_from: query.from ?? null,
    p_cohort_to: query.to ?? null,
    ...retentionFilterParams(query),
  })
  if (error) throw new Error(`Failed to get retention cohorts: ${error.message}`)
  return data as RetentionCohortTable
}

export async function getRetentionFilterOptions(): Promise<RetentionFilterOptions> {
  const { data, error } = await adminRpc('admin_get_retention_filter_options')
  if (error) throw new Error(`Failed to get retention filters: ${error.message}`)
  return data as RetentionFilterOptions
}
