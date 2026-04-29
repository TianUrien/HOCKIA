// Gender label translation. Storage stays as legacy "Men" / "Women" strings
// for backward compatibility with existing rows; the UI shows "Male" / "Female"
// (and "Prefer not to say"). The dropdown option for "Prefer not to say"
// submits a sentinel value that normalizeGenderInput maps to null on save.

export const PREFER_NOT_TO_SAY = 'prefer_not_to_say'

/** Maps a stored gender string (or null) to the user-facing display label. */
export function genderToDisplay(stored: string | null | undefined): string {
  if (!stored) return ''
  const lower = stored.trim().toLowerCase()
  if (lower === 'men' || lower === 'male') return 'Male'
  if (lower === 'women' || lower === 'female') return 'Female'
  return ''
}

/** Maps a dropdown submission value back to the canonical stored value
 * (or null when the user explicitly picked "Prefer not to say" or left it blank). */
export function normalizeGenderInput(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === PREFER_NOT_TO_SAY) return null
  if (lower === 'men' || lower === 'male') return 'Men'
  if (lower === 'women' || lower === 'female') return 'Women'
  return null
}
