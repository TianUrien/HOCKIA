/**
 * Preference Analytics API Module
 *
 * Functions for querying user notification preference analytics.
 * All functions require the caller to be an admin.
 */

import { supabase } from '@/lib/supabase'
import type { PreferenceSummary, PreferenceUser, PreferenceKey } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

/**
 * Get aggregated preference summary (enabled/disabled counts per setting, by role)
 */
export async function getPreferenceSummary(): Promise<PreferenceSummary> {
  const { data, error } = await adminRpc('admin_get_preference_summary')
  if (error) throw new Error(`Failed to get preference summary: ${error.message}`)
  return data as PreferenceSummary
}

/**
 * Get users for a specific preference and state (enabled/disabled)
 */
export async function getPreferenceUsers(params: {
  preference: PreferenceKey
  enabled: boolean
  role?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<{ users: PreferenceUser[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_preference_users', {
    p_preference: params.preference,
    p_enabled: params.enabled,
    p_role: params.role || null,
    p_search: params.search || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get preference users: ${error.message}`)

  const users = (data || []) as PreferenceUser[]
  const totalCount = users.length > 0 ? users[0].total_count : 0

  return { users, totalCount }
}
