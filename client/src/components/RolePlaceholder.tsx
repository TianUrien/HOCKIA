import { useId } from 'react'
import { cn } from '@/lib/utils'
import type { RoleAvatarRole } from '@/lib/roleAvatar'
import { roleGradientStops } from '@/lib/communityCard'

/**
 * THE no-photo treatment: Figma Assets "Avatar / Placeholder" (founder
 * 2026-10-26: never initials). The role gradient (players turf, coaches
 * cyan, umpires ink, clubs blue, brands rust) with a white head-and-shoulders
 * silhouette for people, the club shield for clubs and the kit icon for
 * brands. The shape (circle, or the brand's rounded square) comes from the
 * parent. An SVG, so it scales with any box (32–128 and full-bleed cards).
 *
 * Purely cosmetic: `profiles.avatar_url` stays NULL and every
 * profile-strength scorer still counts the photo as missing. The owner sees
 * the "Add a photo" prompt (AddPhotoPrompt) while they have none.
 */
interface RolePlaceholderProps {
  role: RoleAvatarRole
  /** Kept for callers; no longer drawn (never initials). */
  name?: string | null
  /** Kept for callers; no longer drawn (never initials). */
  initials?: string | null
  className?: string
  /** Accessible label. Pass '' when the parent already names the person. */
  label?: string
}

// Icon/Club and Icon/Benefit/Equipment from the Figma asset, drawn in a 46 box
// inset 27% (the source boxes are 44.16).
const ICON_SCALE = 46 / 44.16
const CLUB_PATHS = [
  'M22.08 6.44L34.96 11.04V21.16C34.96 29.44 29.44 34.96 22.08 37.72C14.72 34.96 9.2 29.44 9.2 21.16V11.04L22.08 6.44Z',
  'M16.56 22.08L20.24 25.76L27.6 18.4',
]
const BRAND_PATHS = [
  'M15.64 7.36L7.36 11.96L10.12 19.32L14.72 17.48V36.8H29.44V17.48L34.04 19.32L36.8 11.96L28.52 7.36C27.416 10.12 25.024 11.96 22.08 11.96C19.136 11.96 16.744 10.12 15.64 7.36Z',
]

export default function RolePlaceholder({ role, className, label }: RolePlaceholderProps) {
  const id = useId()
  const gradientId = `role-placeholder-bg-${id}`
  const [from, to] = roleGradientStops(role)
  const accessibleName = label ?? `${role.charAt(0).toUpperCase() + role.slice(1)} profile photo placeholder`
  const isDecorative = label === ''
  const icon = role === 'club' ? CLUB_PATHS : role === 'brand' ? BRAND_PATHS : null
  const body = (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <stop offset="0" stopColor={from} />
          <stop offset="0.714" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradientId})`} />
      {icon ? (
        <g transform={`translate(27 27) scale(${ICON_SCALE})`} fill="none" stroke="white" strokeWidth={3.22} strokeLinecap="round" strokeLinejoin="round" data-testid="role-placeholder-icon">
          {icon.map((d) => <path key={d} d={d} />)}
        </g>
      ) : (
        <g fill="white" opacity={0.92} data-testid="role-placeholder-silhouette">
          <circle cx="50" cy="38" r="18" />
          <ellipse cx="50" cy="92" rx="37" ry="30" />
        </g>
      )}
    </>
  )
  const wrapperClass = cn('block h-full w-full', className)
  // Separate SVGs so the a11y linter can validate the ARIA attributes.
  if (isDecorative) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role="presentation" aria-hidden="true" className={wrapperClass} data-testid="role-placeholder" data-role={role}>
        {body}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label={accessibleName} className={wrapperClass} data-testid="role-placeholder" data-role={role}>
      {body}
    </svg>
  )
}
