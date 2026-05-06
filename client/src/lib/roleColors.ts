/**
 * Role color palette + helpers.
 *
 * Five admin pages used to redefine the same role→color map inline, in
 * two slightly different shapes (a `{ bg, text }` hex object and a
 * Tailwind class string). This module is the single source of truth so
 * every admin surface uses identical colors and a future palette tweak
 * lands in one place.
 *
 * Hex values match the existing inline maps verbatim — the migration is
 * purely de-duplication, no visual change.
 */

type Role = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

interface RoleColorEntry {
  bg: string
  text: string
}

export const ROLE_COLOR_PALETTE: Record<Role, RoleColorEntry> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach:  { bg: '#F0FDFA', text: '#0D9488' },
  club:   { bg: '#FFF7ED', text: '#EA580C' },
  brand:  { bg: '#FFF1F2', text: '#E11D48' },
  umpire: { bg: '#FEFCE8', text: '#A16207' },
}

const FALLBACK_COLORS: RoleColorEntry = { bg: '#F3F4F6', text: '#4B5563' }
const FALLBACK_BADGE_CLASSES = 'bg-gray-100 text-gray-600'
const FALLBACK_SOLID_BG_CLASS = 'bg-gray-400'
const FALLBACK_SOLID_HEX = '#9CA3AF'

function isKnownRole(role: string | null | undefined): role is Role {
  return role === 'player' || role === 'coach' || role === 'club' || role === 'brand' || role === 'umpire'
}

/**
 * Returns the role's `{ bg, text }` hex object for inline `style={{}}`
 * use. Unknown / null roles return a neutral gray pair.
 *
 * Used by admin tables/badges that render colors via inline style.
 */
export function getRoleColors(role: string | null | undefined): RoleColorEntry {
  return isKnownRole(role) ? ROLE_COLOR_PALETTE[role] : FALLBACK_COLORS
}

/**
 * Returns a Tailwind class string `'bg-[#hex] text-[#hex]'` for badge-
 * style role pills (light bg + role-tinted text). Unknown roles fall
 * back to neutral gray classes.
 *
 * Used by surfaces that build their classNames as strings.
 */
export function getRoleBadgeClasses(role: string | null | undefined): string {
  if (!isKnownRole(role)) return FALLBACK_BADGE_CLASSES
  const { bg, text } = ROLE_COLOR_PALETTE[role]
  return `bg-[${bg}] text-[${text}]`
}

/**
 * Returns a Tailwind solid-background class `'bg-[#hex]'` using the
 * role's text-color hex (the saturated tone). Used for progress bars
 * and other "solid bar" surfaces where the saturated role color is the
 * fill. Unknown roles fall back to bg-gray-400.
 */
export function getRoleSolidBgClass(role: string | null | undefined): string {
  if (!isKnownRole(role)) return FALLBACK_SOLID_BG_CLASS
  return `bg-[${ROLE_COLOR_PALETTE[role].text}]`
}

/**
 * Returns just the saturated hex string (the role's "text" color).
 * Used for inline `style={{ backgroundColor: ... }}` where you need
 * the solid hex rather than a Tailwind class. Unknown roles fall back
 * to gray-400 (#9CA3AF).
 */
export function getRoleSolidColor(role: string | null | undefined): string {
  if (!isKnownRole(role)) return FALLBACK_SOLID_HEX
  return ROLE_COLOR_PALETTE[role].text
}
