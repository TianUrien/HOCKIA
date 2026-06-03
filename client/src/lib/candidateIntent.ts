/**
 * Candidate-intent display helpers (Matching Increment #2 — Interested
 * lens). Shared by the owner dashboard (BasicInfoCard) and the recruiter
 * ScoutingCard so the read-only labels never drift. The enum vocabularies
 * mirror the CHECK constraints in 20260603140000_candidate_intent_fields.
 */

export const RELOCATION_LABEL: Record<string, string> = {
  relocate: 'Open to relocating',
  home_only: 'Staying in home country',
  open_to_discuss: 'Open to discuss',
}

export const LEVEL_TARGET_LABEL: Record<string, string> = {
  top: 'Highest level',
  competitive: 'Competitive',
  development: 'Development',
  any: 'Any level',
}

export const OPPORTUNITY_PREF_LABEL: Record<string, string> = {
  paid: 'Paid',
  development: 'Development',
  either: 'Paid or development',
}

export const DURATION_LABEL: Record<string, string> = {
  full_season: 'Full season',
  half_season: 'Half season',
  short_term: 'Short term',
  flexible: 'Flexible',
}

/** "2026-09-01" → "Sep 2026". Falls back to the raw string if unparseable. */
export function formatAvailableFrom(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export interface CandidateIntentInput {
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  level_target?: string | null
  opportunity_preference?: string | null
  available_from?: string | null
  availability_duration?: string | null
}

export interface IntentRow {
  key: string
  label: string
  value: string
}

/**
 * Build the read-only rows for a candidate's recruitment preferences.
 * `countryName` resolves a countries.id to a display name (e.g. via
 * useCountries getCountryById). Only set fields produce a row.
 */
export function summarizeCandidateIntent(
  p: CandidateIntentInput,
  countryName: (id: number) => string | undefined,
): { rows: IntentRow[]; hasAny: boolean } {
  const rows: IntentRow[] = []

  if (p.relocation_willingness) {
    rows.push({
      key: 'relocation',
      label: 'Relocation',
      value: RELOCATION_LABEL[p.relocation_willingness] ?? p.relocation_willingness,
    })
  }

  const availability = p.available_from
    ? `From ${formatAvailableFrom(p.available_from)}${
        p.availability_duration ? ` · ${DURATION_LABEL[p.availability_duration] ?? ''}` : ''
      }`
    : p.availability_duration
      ? (DURATION_LABEL[p.availability_duration] ?? null)
      : null
  if (availability) rows.push({ key: 'availability', label: 'Availability', value: availability })

  if (p.level_target) {
    rows.push({ key: 'level', label: 'Level target', value: LEVEL_TARGET_LABEL[p.level_target] ?? p.level_target })
  }
  if (p.opportunity_preference) {
    rows.push({
      key: 'preference',
      label: 'Looking for',
      value: OPPORTUNITY_PREF_LABEL[p.opportunity_preference] ?? p.opportunity_preference,
    })
  }

  const open = (p.relocation_countries_open ?? []).map(countryName).filter((n): n is string => Boolean(n))
  if (open.length > 0) rows.push({ key: 'open', label: 'Open to countries', value: open.join(', ') })

  const excluded = (p.relocation_countries_excluded ?? []).map(countryName).filter((n): n is string => Boolean(n))
  if (excluded.length > 0) rows.push({ key: 'excluded', label: 'Would not consider', value: excluded.join(', ') })

  return { rows, hasAny: rows.length > 0 }
}
