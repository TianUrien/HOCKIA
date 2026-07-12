// deno-lint-ignore-file no-explicit-any
/**
 * Similar-open-opportunities block for player emails (rejection + expiry).
 * Data comes from the service-role-only SQL RPC similar_open_opportunities
 * (eligibility-hard-filtered, position-then-recency ranked — fewer than N
 * good matches naturally falls back to newest open, never forced bad ones).
 */

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

function suggestionMeta(s: OpportunitySuggestion): string {
  return [
    s.position_text ? s.position_text.replace(/_/g, ' ') : null,
    s.gender,
    [s.location_city, s.location_country].filter(Boolean).join(', ') || null,
    s.publisher_name,
  ].filter(Boolean).join(' · ')
}

export function suggestionsHtml(suggestions: OpportunitySuggestion[], baseUrl: string): string {
  if (suggestions.length === 0) return ''
  const rows = suggestions.map((s) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f2;">
      <a href="${baseUrl}/opportunities/${s.opportunity_id}" style="font-size:14px;font-weight:600;color:#6d28d9;text-decoration:none;">${escapeHtml(s.title)}</a>
      <div style="font-size:12.5px;color:#6b7280;margin-top:2px;">${escapeHtml(suggestionMeta(s))}</div>
    </td></tr>`).join('')
  return `
    <div style="margin-top:20px;">
      <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px;">Open opportunities for you</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>`
}

export function suggestionsText(suggestions: OpportunitySuggestion[], baseUrl: string): string {
  if (suggestions.length === 0) return ''
  return [
    '',
    'Open opportunities for you:',
    ...suggestions.map((s) => `- ${s.title} (${suggestionMeta(s)}): ${baseUrl}/opportunities/${s.opportunity_id}`),
  ].join('\n')
}
