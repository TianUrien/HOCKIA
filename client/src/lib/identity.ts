/**
 * Identity copy rules from the Figma redesign (00 Architecture, decision 5):
 * "Roles are always visible" — every row, card, preview and chat header reads
 * "Player · Midfielder", "Coach · Head coach", "Club · Serie A1",
 * "Brand · Equipment". Role is never implicit.
 *
 * The words come from the "enums" catalog (role.*, position.*,
 * coachSpecialization.*, category.*, brandCategory.*). A token the catalog
 * does not know falls back to the string manipulation in humanizeToken.
 */
import { isEnglish } from '@/i18n/format'
import { hasEnumsKey, tEnums } from '@/i18n/ns/enums'

export type RoleLike = 'player' | 'coach' | 'club' | 'umpire' | 'brand' | (string & {}) | null | undefined

const ROLES = ['player', 'coach', 'club', 'umpire', 'brand']

/** ' Head_Coach' → 'head_coach'; null when the text is not a stored token (free text such as "Head Coach" keeps its own casing). */
function tokenKey(value: string): string | null {
  const key = value.trim().toLowerCase()
  return /^[a-z0-9_]+$/.test(key) ? key : null
}

/** The catalog's label for a token, from the first group that has it. */
function catalogLabel(groups: readonly string[], value: string): string | null {
  const key = tokenKey(value)
  if (!key) return null
  for (const group of groups) {
    const id = `${group}.${key}`
    if (hasEnumsKey(id)) return tEnums(id as never) as string
  }
  return null
}

export function roleLabel(role: RoleLike): string {
  const key = role?.toLowerCase()
  return key && ROLES.includes(key) ? tEnums(`role.${key}` as never) as string : tEnums('role.member')
}

export function isOrganisationRole(role: RoleLike): boolean {
  const r = role?.toLowerCase()
  return r === 'club' || r === 'brand'
}

/** 'head_coach' → 'Head coach', 'goalkeeper' → 'Goalkeeper'. Already-cased
 *  text ("Forward, Midfielder", "Serie A1") is left alone apart from the
 *  first letter. */
export function humanizeToken(value: string | null | undefined): string | null {
  if (!value) return null
  const words = value.replace(/[_-]+/g, ' ').trim()
  if (!words) return null
  const rest = words.slice(1)
  const english = words.charAt(0).toUpperCase() + (rest === rest.toUpperCase() && rest.length > 1 ? rest.toLowerCase() : rest)
  // English keeps the manipulated text for every token: a few catalog labels
  // read differently ("Strength & conditioning", "Women's") and callers of
  // this helper have always shown the plain form.
  if (isEnglish()) return english
  return catalogLabel(HUMANIZE_GROUPS, value) ?? english
}

const HUMANIZE_GROUPS = ['position', 'coachSpecialization', 'role', 'category']

/**
 * "Player · Midfielder" / "Club · Serie A1" / "Coach". `detail` is the
 * role-specific second half (position, league, specialisation); omitted
 * when unknown rather than padded with a placeholder.
 */
export function identityLine(role: RoleLike, detail?: string | null): string {
  const label = roleLabel(role)
  const extra = humanizeToken(detail)
  return extra ? `${label} · ${extra}` : label
}

/** Stored position / coaching-role enums → the words people read. Player
 *  positions, the opportunity coach enum and the profile coach
 *  specialisation vocabulary all land here, so a feed card never shows
 *  "head_coach" or "strength_conditioning". */
const POSITION_GROUPS = ['position', 'coachSpecialization']

export function positionLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return catalogLabel(POSITION_GROUPS, value) ?? humanizeToken(value)
}

/** A coach's specialisation in sentence case ("Head coach"), the custom
 *  title for "other" — the one label every Club v2 surface uses (Inbox
 *  rows, Squad lines, key facts, chat card, Fit panel). */
export function coachSpecialtyLabel(spec: string | null | undefined, custom?: string | null): string | null {
  const key = spec?.trim().toLowerCase() || null
  const own = custom?.trim() || null
  if (!key) return own
  if (key === 'other' || key === 'other_coach') return own ?? tEnums('coachSpecialization.other_coach')
  return positionLabel(key)
}

/** brands.category enum → label ("coaching" → "Coaching & Training"). */
export function brandCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return catalogLabel(['brandCategory'], value) ?? humanizeToken(value)
}
