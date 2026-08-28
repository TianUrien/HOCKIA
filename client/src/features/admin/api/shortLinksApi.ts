/**
 * Short links admin API — thin wrappers over the SQL functions.
 */

import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

export interface ShortLinkRow {
  code: string
  label: string
  destination: string
  utm_source: string
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  is_active: boolean
  click_count: number
  last_clicked_at: string | null
  created_at: string
  clicks_30d: number
  signups: number
  normalized_source: string | null
}

export interface ShortLinkInput {
  code: string
  label: string
  destination: string
  utm_source: string
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  is_active?: boolean
}

export async function listShortLinks(): Promise<ShortLinkRow[]> {
  const { data, error } = await adminRpc('admin_list_short_links')
  if (error) throw new Error(`Failed to load short links: ${error.message}`)
  return (data ?? []) as ShortLinkRow[]
}

export async function upsertShortLink(input: ShortLinkInput): Promise<void> {
  const { error } = await adminRpc('admin_upsert_short_link', { p: input })
  if (error) throw new Error(error.message)
}
