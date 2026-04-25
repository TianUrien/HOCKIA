/**
 * Umpire level suggestions.
 *
 * Stored as free text on `profiles.umpire_level` — the taxonomy varies
 * across federations and we don't want to force a rigid shape in v1.
 * This list is the *datalist suggestion set*: umpires get friction-free
 * autocomplete for the canonical FIH + common national grades, but can
 * type anything that reflects their reality (e.g. "Indoor Panel",
 * "State Level 2"). Canonicalize once we see real data.
 */
export const UMPIRE_LEVEL_SUGGESTIONS = [
  'FIH World Panel',
  'FIH International Umpire',
  'Continental Panel',
  'National Panel',
  'National',
  'Regional',
  'Club',
  'Learning',
] as const
