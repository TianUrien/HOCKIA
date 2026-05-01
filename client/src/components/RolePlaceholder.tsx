import { useId } from 'react'
import { cn } from '@/lib/utils'
import type { RoleAvatarRole } from '@/lib/roleAvatar'

/**
 * Role-based avatar placeholder.
 *
 * Renders a square SVG with a soft gradient background + a simple person
 * silhouette, both coloured per role. The visual upgrade replaces the
 * purple "initials block" we used to fall back to whenever a user had no
 * avatar uploaded — the old fallback made the Community grid look raw and
 * the same colour for every role; the new fallback keeps the cards
 * polished AND makes the user's role legible at a glance.
 *
 * IMPORTANT: this is purely cosmetic. A user rendering with a placeholder
 * still has `profiles.avatar_url = NULL` and is correctly counted as
 * "missing photo" by every profile-completion / milestone scorer. The
 * placeholder doesn't write anywhere — it's only what the UI shows.
 *
 * Colour palette mirrors RoleBadge so the placeholder + role badge feel
 * like the same family. Each role gets:
 *   - a soft top-left → bottom-right background gradient
 *   - a stronger fill colour for the silhouette
 *
 * Multiple instances on one page are SVG-id-collision-safe via useId().
 */

interface RolePalette {
  bgFrom: string
  bgTo: string
  fill: string
}

// Hex values match the RoleBadge palette so a card's avatar placeholder and
// its role badge feel like one design. Slightly desaturated background +
// stronger figure fill so the silhouette has clear contrast at all sizes.
const PALETTES: Record<RoleAvatarRole, RolePalette> = {
  player: { bgFrom: '#DBEAFE', bgTo: '#EFF6FF', fill: '#3B82F6' },
  coach: { bgFrom: '#D1FAE5', bgTo: '#F0FDF4', fill: '#10B981' },
  club: { bgFrom: '#FFEDD5', bgTo: '#FFF7ED', fill: '#F97316' },
  brand: { bgFrom: '#FFE4E6', bgTo: '#FFF1F2', fill: '#F43F5E' },
  umpire: { bgFrom: '#FEF3C7', bgTo: '#FEFCE8', fill: '#D97706' },
}

interface RolePlaceholderProps {
  role: RoleAvatarRole
  className?: string
  /** Inline accessible label — usually the user's name. Defaults to the
   *  role name so a screen reader at least announces what kind of profile
   *  is rendered. Pass an empty string to mark fully decorative when the
   *  parent already exposes the name. */
  label?: string
}

export default function RolePlaceholder({ role, className, label }: RolePlaceholderProps) {
  const id = useId()
  const gradientId = `role-placeholder-bg-${id}`
  // Defensive: if a runtime-corrupted role value somehow bypasses the TS
  // narrowing (stale cached query, future role added without updating
  // the palette, etc.), fall back to the player palette so the SVG still
  // renders something instead of empty stops/transparent fills. Logged
  // via the type guard at every entry point in production callers; this
  // is the last line of defence at render time.
  const palette = PALETTES[role] ?? PALETTES.player
  const accessibleName = label ?? `${role.charAt(0).toUpperCase() + role.slice(1)} profile photo placeholder`
  const isDecorative = label === ''
  const wrapperClass = cn('block h-full w-full', className)

  // Render the decorative vs labelled cases as separate SVGs so the JSX
  // a11y linter can statically validate the ARIA attribute values
  // (otherwise it sees `role={expr}` and can't tell it's safe).
  if (isDecorative) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
        aria-hidden="true"
        className={wrapperClass}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.bgFrom} />
            <stop offset="100%" stopColor={palette.bgTo} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradientId})`} />
        <circle cx="50" cy="40" r="14" fill={palette.fill} />
        <path
          d="M 22 100 C 22 76, 35 65, 50 65 C 65 65, 78 76, 78 100 Z"
          fill={palette.fill}
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={accessibleName}
      className={wrapperClass}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.bgFrom} />
          <stop offset="100%" stopColor={palette.bgTo} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradientId})`} />
      {/* Head — circle slightly above centre. */}
      <circle cx="50" cy="40" r="14" fill={palette.fill} />
      {/* Body — rounded torso shape that meets the bottom edge so the
          figure looks anchored at any aspect ratio. */}
      <path
        d="M 22 100 C 22 76, 35 65, 50 65 C 65 65, 78 76, 78 100 Z"
        fill={palette.fill}
      />
    </svg>
  )
}

// `isRoleAvatarRole` helper moved to lib/roleAvatar.ts so this file only
// exports a component (Vite fast-refresh rule).
