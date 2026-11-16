// deno-lint-ignore-file no-explicit-any
/**
 * Similar-open-opportunities block for player emails (rejection + expiry).
 * Data comes from the service-role-only SQL RPC similar_open_opportunities
 * (eligibility-hard-filtered, position-then-recency ranked — fewer than N
 * good matches naturally falls back to newest open, never forced bad ones).
 */

import { type MemberLanguage, spanishPositionLabel } from './member-language.ts'

export interface OpportunitySuggestion {
  opportunity_id: string
  title: string
  position_text: string | null
  opportunity_type: string | null
  gender: string | null
  location_city: string | null
  location_country: string | null
  publisher_name: string | null
}

export async function fetchSuggestions(
  supabase: any,
  applicantId: string,
  excludeOpportunityIds: string[],
  limit = 3,
): Promise<OpportunitySuggestion[]> {
  const { data, error } = await supabase.rpc('similar_open_opportunities', {
    p_applicant: applicantId,
    p_exclude: excludeOpportunityIds,
    p_limit: limit,
  })
  if (error || !data) return []
  return data as OpportunitySuggestion[]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** opportunities.gender values in Spanish (enums.json category). */
const GENDER_ES: Record<string, string> = {
  men: 'Caballeros',
  women: 'Damas',
  boys: 'Juveniles caballeros',
  girls: 'Juveniles damas',
  mixed: 'Mixto',
}

function suggestionMeta(s: OpportunitySuggestion, language: MemberLanguage = 'en'): string {
  if (language === 'es') {
    return [
      s.position_text ? spanishPositionLabel(s.position_text) ?? s.position_text.replace(/_/g, ' ') : null,
      s.gender ? GENDER_ES[s.gender.trim().toLowerCase()] ?? s.gender : null,
      [s.location_city, s.location_country].filter(Boolean).join(', ') || null,
      s.publisher_name,
    ].filter(Boolean).join(' · ')
  }
  return [
    s.position_text ? s.position_text.replace(/_/g, ' ') : null,
    s.gender,
    [s.location_city, s.location_country].filter(Boolean).join(', ') || null,
    s.publisher_name,
  ].filter(Boolean).join(' · ')
}

export function suggestionsHtml(
  suggestions: OpportunitySuggestion[],
  baseUrl: string,
  language: MemberLanguage = 'en',
): string {
  if (suggestions.length === 0) return ''
  const rows = suggestions.map((s) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f2;">
      <a href="${baseUrl}/opportunities/${s.opportunity_id}" style="font-size:14px;font-weight:600;color:#6d28d9;text-decoration:none;">${escapeHtml(s.title)}</a>
      <div style="font-size:12.5px;color:#6b7280;margin-top:2px;">${escapeHtml(suggestionMeta(s, language))}</div>
    </td></tr>`).join('')
  return `
    <div style="margin-top:20px;">
      <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px;">${language === 'es' ? 'Oportunidades abiertas que pueden interesarte' : 'Open opportunities for you'}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>`
}

export function suggestionsText(
  suggestions: OpportunitySuggestion[],
  baseUrl: string,
  language: MemberLanguage = 'en',
): string {
  if (suggestions.length === 0) return ''
  return [
    '',
    language === 'es' ? 'Oportunidades abiertas que pueden interesarte:' : 'Open opportunities for you:',
    ...suggestions.map((s) => `- ${s.title} (${suggestionMeta(s, language)}): ${baseUrl}/opportunities/${s.opportunity_id}`),
  ].join('\n')
}
