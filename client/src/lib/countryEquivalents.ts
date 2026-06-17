/**
 * Client mirror of the SQL expand_country_equivalents() that
 * community_search_members / discover_profiles apply to nationality + location
 * country-id filters. HOCKIA's countries table splits the United Kingdom
 * (code 'GB') from England (code 'GB-ENG'), and the server filters treat the
 * two as equivalent so user-entered "United Kingdom" still matches England-coded
 * members (and vice versa).
 *
 * The Community grid's defensive client-side re-filter MUST apply the same
 * expansion — otherwise it under-shows England-coded members when "United
 * Kingdom" is selected (server returns them, the raw client re-filter drops
 * them), diverging from the server pool. Keyed by country CODE (not hardcoded
 * ids) so it stays correct across environments.
 */
export function expandCountryEquivalents(
  ids: number[],
  countries: { id: number; code: string | null }[],
): number[] {
  if (ids.length === 0) return ids
  const gbId = countries.find((c) => c.code === 'GB')?.id
  const gbEngId = countries.find((c) => c.code === 'GB-ENG')?.id
  if (gbId == null || gbEngId == null) return ids
  const result = new Set(ids)
  if (result.has(gbId)) result.add(gbEngId)
  if (result.has(gbEngId)) result.add(gbId)
  return [...result]
}
