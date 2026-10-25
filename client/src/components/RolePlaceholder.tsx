import { useId } from 'react'
import { cn } from '@/lib/utils'
import type { RoleAvatarRole } from '@/lib/roleAvatar'
import { initialsOf, roleGradientStops } from '@/lib/communityCard'

/**
 * THE no-photo treatment (design audit 2026-10-21, Batch C): the role
 * gradient (rebrand: players turf, coaches cyan, umpires ink, brands rust,
 * clubs HOCKIA violet) with white initials, letters only ("[QA] iOS Layout"
 * → "IL"). Replaces the pastel tile + grey silhouette. The shape (circle for
 * people, rounded square for organisations) comes from the parent.
 *
 * An SVG, so the initials scale with any box: 26 pt tab bar, 52 rows, the
 * 160 pt applicant detail, a full-bleed deck card.
 *
 * Purely cosmetic: `profiles.avatar_url` stays NULL and every
 * profile-strength scorer still counts the photo as missing.
 */
interface RolePlaceholderProps {
  role: RoleAvatarRole
  /** The person's or organisation's name; initials are derived (letters only). */
  name?: string | null
  /** Ready-made initials (wins over `name`); normalised to letters only. */
  initials?: string | null
  className?: string
  /** Accessible label. Pass '' when the parent already names the person. */
  label?: string
}

export default function RolePlaceholder({ role, name, initials, className, label }: RolePlaceholderProps) {
  const id = useId()
  const gradientId = `role-placeholder-bg-${id}`
  const [from, to] = roleGradientStops(role)
  // Ready-made initials keep their letters ("AL"); a name is reduced by the shared rule.
  const given = initials?.replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase()
  const letters = given || initialsOf(name ?? '')
  const text = letters === '?' ? '' : letters
  const accessibleName = label ?? `${role.charAt(0).toUpperCase() + role.slice(1)} profile photo placeholder`
  const isDecorative = label === ''
  const body = (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="14%" stopColor={from} />
          <stop offset="86%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradientId})`} />
      {text && (
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-white" fontSize={text.length > 1 ? 36 : 42} fontWeight={600} fontFamily="inherit" letterSpacing="0.5" data-testid="role-placeholder-initials">
          {text}
        </text>
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
