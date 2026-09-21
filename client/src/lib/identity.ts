/**
 * Identity copy rules from the Figma redesign (00 Architecture, decision 5):
 * "Roles are always visible" — every row, card, preview and chat header reads
 * "Player · Midfielder", "Coach · Head coach", "Club · Serie A1",
 * "Brand · Equipment". Role is never implicit.
 */

export type RoleLike = 'player' | 'coach' | 'club' | 'umpire' | 'brand' | (string & {}) | null | undefined

const ROLE_LABELS: Record<string, string> = {
  player: 'Player',
  coach: 'Coach',
  club: 'Club',
  umpire: 'Umpire',
  brand: 'Brand',
}

export function roleLabel(role: RoleLike): string {
  if (!role) return 'Member'
  return ROLE_LABELS[role.toLowerCase()] ?? 'Member'
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
  return words.charAt(0).toUpperCase() + (rest === rest.toUpperCase() && rest.length > 1 ? rest.toLowerCase() : rest)
}

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
