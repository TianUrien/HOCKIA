/**
 * Retention filter mapping and checkpoint defaults.
 *
 * Deliberately free of any Supabase import: the CSV/filter tests exercise
 * this logic, and the CI unit job runs with NO env vars — anything that
 * reaches lib/supabase throws at import time there (same trap as
 * lib/authStorageKey). api/retentionApi re-exports these.
 */

import type { RetentionFilters } from '../types/retention'

export const DEFAULT_RETENTION_DAYS = [7, 15, 30]

/** Filters → RPC params. One mapper, so the cards and the grid can never
 *  apply a filter to one call and not the other. */
export function retentionFilterParams(filters: RetentionFilters = {}): Record<string, unknown> {
  return {
    p_role: filters.role ?? null,
    p_country_id: filters.countryId ?? null,
    p_platform: filters.platform ?? null,
    p_source: filters.source ?? null,
  }
}
