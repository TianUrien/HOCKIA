/**
 * EU eligibility — derived from nationality, dual-aware.
 *
 * A candidate is EU-eligible when EITHER declared nationality is an EU member
 * state. A candidate with NO nationality on file is KEPT (an incomplete profile
 * is never a reason to hide someone — mirrors opportunityEligibility.ts and the
 * application-gate DB trigger). The EU country-id set is derived from
 * EU_COUNTRY_CODES (useCountries) at the call site.
 *
 * Single source for both the scope-driven EU hard-filter and the user-facing
 * "EU-eligible only" toggle, so the two can never disagree.
 */
export function isEuEligible(
  nationalityCountryId: number | null | undefined,
  nationality2CountryId: number | null | undefined,
  euCountryIds: Set<number>,
): boolean {
  const ids = [nationalityCountryId, nationality2CountryId].filter(
    (id): id is number => typeof id === 'number',
  )
  if (ids.length === 0) return true // unknown nationality → keep
  return ids.some((id) => euCountryIds.has(id))
}
