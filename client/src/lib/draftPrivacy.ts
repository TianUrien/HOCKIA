/**
 * Draft autosave keeps form work across app reloads, but personal details
 * never go to browser storage: date of birth is owner/server-only (age gate,
 * docs/engineering/security.md §3.2 and §3.5), and nationality / passports
 * and a role's category stay out too (CodeQL
 * js/clear-text-storage-of-sensitive-data, 2026-10-25). A restored draft
 * leaves those fields to the server prefill, or asks for them again.
 *
 * Applied both when a draft is written and when one is read, so a draft
 * saved before this change no longer restores them either.
 */

/** Field names of personal details across the profile and set-up forms. */
export const SENSITIVE_DRAFT_FIELDS = [
  'date_of_birth',
  'dateOfBirth',
  'nationality',
  'nationality_name',
  'nationality_country_id',
  'nationality2_country_id',
  'nationalityCountryId',
  'nationality2CountryId',
  'passport1',
  'passport2',
  'showSecondPassport',
] as const

type SensitiveDraftField = (typeof SENSITIVE_DRAFT_FIELDS)[number]

/** Copy of a profile / set-up draft without the personal-detail fields. */
export function withoutSensitiveDraftFields<T extends object>(data: T): Omit<T, SensitiveDraftField> {
  /* eslint-disable @typescript-eslint/no-unused-vars -- named only to leave them out */
  const {
    date_of_birth: _dateOfBirthColumn,
    dateOfBirth: _dateOfBirth,
    nationality: _nationality,
    nationality_name: _nationalityName,
    nationality_country_id: _nationalityColumn,
    nationality2_country_id: _nationality2Column,
    nationalityCountryId: _nationalityCountryId,
    nationality2CountryId: _nationality2CountryId,
    passport1: _passport1,
    passport2: _passport2,
    showSecondPassport: _showSecondPassport,
    ...rest
  } = data as T & Partial<Record<SensitiveDraftField, unknown>>
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest
}

/** Copy of a role (opportunity) draft without its gender category. */
export function withoutRoleCategory<T extends { gender?: unknown }>(data: T): Omit<T, 'gender'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave it out
  const { gender: _gender, ...rest } = data
  return rest
}
