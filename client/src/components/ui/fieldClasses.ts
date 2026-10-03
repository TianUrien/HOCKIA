/**
 * Form field classes shared by the account-first auth / onboarding screens
 * and the 'field' appearance of the pickers they embed (WorldClubSearch,
 * CountrySelect, LocationAutocomplete, DateOfBirthPicker, PlayerLeagueField).
 *
 * Figma "Field header" (472:180): 13 semibold, ink-2, 6 px above the field.
 * Figma "Text field" (472:243): 50 tall, surface-muted fill, radius 12,
 * 16 px value, ink-3 placeholder, no border at rest; white with the brand
 * border on focus. The Select variant adds a trailing chevron (ink-4, the
 * non-text grey). A 16 px value also keeps iOS Safari from zooming the page
 * when a field gets focus.
 */

/** Field header text only (for a label that sits in its own row). */
export const fieldLabelText = 'text-secondary font-semibold text-ink-2'
export const fieldLabel = `mb-1.5 block ${fieldLabelText}`

/** Text field without horizontal padding (pickers set their own for icons). */
export const fieldInputBase =
  'h-[50px] w-full rounded-[12px] bg-surface-muted text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-hockia-primary'
export const fieldInput = `${fieldInputBase} px-3.5`

/** Trailing chevron (ink-4) for a native `<select>`. The data URI has no
 *  spaces (%20): the Tailwind scanner splits candidates on whitespace, so a
 *  URL with literal spaces never becomes a class. */
const CHEVRON =
  "appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2720%27%20height=%2720%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23aeaeb2%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E')] bg-[length:20px_20px] bg-no-repeat"

/** Text field, Type: Select. */
export const fieldSelect = `${fieldInput} ${CHEVRON} bg-[position:right_14px_center] pr-11`
/** Select in a narrow column (date of birth: day / month / year). */
export const fieldSelectCompact = `${fieldInputBase} ${CHEVRON} bg-[position:right_6px_center] pl-3 pr-8`

/** A value that cannot be edited here (locked date of birth, the club's league). */
export const fieldReadOnly = 'flex h-[50px] w-full items-center rounded-[12px] bg-surface-muted px-3.5 text-[16px] leading-[22px] text-ink-1'

/** Error ring on a field (replaces the focus ring while the error shows). */
export const fieldErrorRing = 'ring-1 ring-inset ring-status-danger'
/** Error line under a field. */
export const fieldErrorText = 'mt-1.5 text-caption text-status-danger'
