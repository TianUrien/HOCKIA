/**
 * Form field classes shared by the account-first auth / onboarding screens
 * and the 'field' appearance of the pickers they embed (WorldClubSearch,
 * CountrySelect, LocationAutocomplete, DateOfBirthPicker, PlayerLeagueField).
 *
 * Rebrand 2026-10-25 (Figma Input / Text field 74:350): label UI/Label (14
 * medium, ink-1) 6 px above the field; the field is 50 tall, white, 1 px
 * border/default, radius 16, ink-3 placeholder; focus = 2 px violet ring;
 * error = red border plus a red message. The Select variant adds a trailing
 * chevron (ink-4, the non-text grey). The value stays 16 px (Figma Body/M is
 * 15): below 16 px iOS Safari zooms the page when a field gets focus.
 */

/** Field header text only (for a label that sits in its own row). */
export const fieldLabelText = 'text-[14px] font-medium leading-[18px] text-ink-1'
export const fieldLabel = `mb-1.5 block ${fieldLabelText}`

/** Text field without horizontal padding (pickers set their own for icons). */
export const fieldInputBase =
  'h-[50px] w-full rounded-[16px] border border-line bg-white text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:border-brand-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-primary disabled:bg-surface-muted disabled:opacity-60'
export const fieldInput = `${fieldInputBase} px-4`

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
export const fieldReadOnly = 'flex h-[50px] w-full items-center rounded-[16px] border border-line bg-surface-muted px-4 text-[16px] leading-[22px] text-ink-1'

/** Error ring on a field (replaces the focus ring while the error shows). */
export const fieldErrorRing = 'border-status-danger focus:border-status-danger focus-visible:ring-status-danger'
/** Error line under a field. */
export const fieldErrorText = 'mt-1.5 text-[12px] font-medium leading-[16px] text-status-danger'

/** Field header with a trailing requirement tag (Figma Field header,
 *  Requirement: Optional — 12 caption, ink-3, right-aligned). */
export const fieldLabelRow = `mb-1.5 flex items-center justify-between gap-2 ${fieldLabelText}`
export const fieldOptionalTag = 'text-[12px] font-medium text-ink-3'
