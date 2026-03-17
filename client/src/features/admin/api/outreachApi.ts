/**
 * Outreach API Module
 *
 * Functions for managing external outreach contacts and campaigns.
 * All functions require the caller to be an admin.
 */

import { supabase } from '@/lib/supabase'
import type {
  OutreachContact,
  OutreachStats,
  OutreachContactFilters,
  OutreachAudiencePreview,
  OutreachImportResult,
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

/**
 * Bulk import outreach contacts from CSV data
 */
export async function bulkImportOutreachContacts(
  contacts: Array<{
    email: string
    contact_name?: string
    club_name: string
    country?: string
    role_at_club?: string
    phone?: string
    notes?: string
  }>
): Promise<OutreachImportResult> {
  const { data, error } = await adminRpc('admin_bulk_import_outreach_contacts', {
    p_contacts: contacts,
  })
  if (error) throw new Error(`Failed to import contacts: ${error.message}`)
  return data as OutreachImportResult
}

/**
 * Get paginated outreach contacts with filters
 */
export async function getOutreachContacts(
  filters: OutreachContactFilters = {}
): Promise<{ contacts: OutreachContact[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_outreach_contacts', {
    p_status: filters.status || null,
    p_country: filters.country || null,
    p_search: filters.search || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0,
  })
  if (error) throw new Error(`Failed to get outreach contacts: ${error.message}`)

  const contacts = (data || []) as OutreachContact[]
  const totalCount = contacts.length > 0 ? contacts[0].total_count : 0

  return { contacts, totalCount }
}

/**
 * Get outreach funnel stats
 */
export async function getOutreachStats(): Promise<OutreachStats> {
  const { data, error } = await adminRpc('admin_get_outreach_stats')
  if (error) throw new Error(`Failed to get outreach stats: ${error.message}`)
  return data as OutreachStats
}

/**
 * Add a single outreach contact manually
 */
export async function addOutreachContact(contact: {
  email: string
  club_name: string
  contact_name?: string
  country?: string
  role_at_club?: string
  instagram?: string
  notes?: string
}): Promise<{ id: string }> {
  const { data, error } = await adminRpc('admin_add_outreach_contact', {
    p_email: contact.email,
    p_club_name: contact.club_name,
    p_contact_name: contact.contact_name || null,
    p_country: contact.country || null,
    p_role_at_club: contact.role_at_club || null,
    p_instagram: contact.instagram || null,
    p_notes: contact.notes || null,
  })
  if (error) throw new Error(error.message)
  return data as { id: string }
}

/**
 * Get all outreach contacts (for contact picker — no pagination)
 */
export async function getAllOutreachContacts(
  filters: { status?: string; country?: string; club?: string } = {}
): Promise<OutreachContact[]> {
  const { data, error } = await adminRpc('admin_get_outreach_contacts', {
    p_status: filters.status || null,
    p_country: filters.country || null,
    p_search: filters.club || null,
    p_limit: 1000,
    p_offset: 0,
  })
  if (error) throw new Error(`Failed to get outreach contacts: ${error.message}`)
  return (data || []) as OutreachContact[]
}

/**
 * Preview outreach campaign audience
 */
export async function previewOutreachAudience(
  audienceFilter: { country?: string; status?: string; club?: string; contact_ids?: string[] } = {}
): Promise<OutreachAudiencePreview> {
  const { data, error } = await adminRpc('admin_preview_outreach_audience', {
    p_audience_filter: audienceFilter,
  })
  if (error) throw new Error(`Failed to preview outreach audience: ${error.message}`)
  return data as OutreachAudiencePreview
}
