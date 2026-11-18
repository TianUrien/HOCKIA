/**
 * Candidate-intent display helpers (Matching Increment #2 — Interested
 * lens). Shared by the owner dashboard (BasicInfoCard) and the recruiter
 * ScoutingCard so the read-only labels never drift. The enum vocabularies
 * mirror the CHECK constraints in 20260603140000_candidate_intent_fields.
 */
import { tRecruiting } from '@/i18n/ns/recruiting'
import { intlLocale, isEnglish } from '@/i18n/format'
import { lazyTextRecord } from './opportunityLazyText'
import { countryLabel } from '@/i18n/countryNames'

// Labels are read through getters, so each read follows the interface language.
export const RELOCATION_LABEL: Record<string, string> = /* @__PURE__ */ lazyTextRecord({
  relocate: () => tRecruiting('candidateIntent.relocation.relocate'),
  home_only: () => tRecruiting('candidateIntent.relocation.homeOnly'),
  open_to_discuss: () => tRecruiting('candidateIntent.relocation.openToDiscuss'),
})

export const LEVEL_TARGET_LABEL: Record<string, string> = /* @__PURE__ */ lazyTextRecord({
  top: () => tRecruiting('candidateIntent.levelTarget.top'),
  competitive: () => tRecruiting('candidateIntent.levelTarget.competitive'),
  development: () => tRecruiting('candidateIntent.levelTarget.development'),
  any: () => tRecruiting('candidateIntent.levelTarget.any'),
})

export const OPPORTUNITY_PREF_LABEL: Record<string, string> = /* @__PURE__ */ lazyTextRecord({
  paid: () => tRecruiting('candidateIntent.preference.paid'),
  development: () => tRecruiting('candidateIntent.preference.development'),
  either: () => tRecruiting('candidateIntent.preference.either'),
})

export const DURATION_LABEL: Record<string, string> = /* @__PURE__ */ lazyTextRecord({
  full_season: () => tRecruiting('candidateIntent.duration.fullSeason'),
  half_season: () => tRecruiting('candidateIntent.duration.halfSeason'),
  short_term: () => tRecruiting('candidateIntent.duration.shortTerm'),
  flexible: () => tRecruiting('candidateIntent.duration.flexible'),
})

/** "2026-09-01" → "Sep 2026". Falls back to the raw string if unparseable. */
export function formatAvailableFrom(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  // English keeps the browser's own locale (unchanged output); other languages use the interface language.
  return d.toLocaleDateString(isEnglish() ? undefined : intlLocale(), { month: 'short', year: 'numeric' })
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
      label: tRecruiting('candidateIntent.rows.relocation'),
      value: RELOCATION_LABEL[p.relocation_willingness] ?? p.relocation_willingness,
    })
  }

  const availability = p.available_from
    ? p.availability_duration
      ? tRecruiting('candidateIntent.availableFromFor', {
          date: formatAvailableFrom(p.available_from),
          duration: DURATION_LABEL[p.availability_duration] ?? '',
        })
      : tRecruiting('candidateIntent.availableFrom', { date: formatAvailableFrom(p.available_from) })
    : p.availability_duration
      ? (DURATION_LABEL[p.availability_duration] ?? null)
      : null
  if (availability) rows.push({ key: 'availability', label: tRecruiting('candidateIntent.rows.availability'), value: availability })

  if (p.level_target) {
    rows.push({ key: 'level', label: tRecruiting('candidateIntent.rows.level'), value: LEVEL_TARGET_LABEL[p.level_target] ?? p.level_target })
  }
  if (p.opportunity_preference) {
    rows.push({
      key: 'preference',
      label: tRecruiting('candidateIntent.rows.lookingFor'),
      value: OPPORTUNITY_PREF_LABEL[p.opportunity_preference] ?? p.opportunity_preference,
    })
  }

  const open = (p.relocation_countries_open ?? []).map(countryName).filter((n): n is string => Boolean(n)).map((n) => countryLabel(n))
  if (open.length > 0) rows.push({ key: 'open', label: tRecruiting('candidateIntent.rows.openCountries'), value: open.join(', ') })

  const excluded = (p.relocation_countries_excluded ?? []).map(countryName).filter((n): n is string => Boolean(n)).map((n) => countryLabel(n))
  if (excluded.length > 0) rows.push({ key: 'excluded', label: tRecruiting('candidateIntent.rows.excludedCountries'), value: excluded.join(', ') })

  return { rows, hasAny: rows.length > 0 }
}
