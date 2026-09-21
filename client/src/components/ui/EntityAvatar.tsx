import Avatar from '@/components/Avatar'
import { getInitials } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { RoleLike } from '@/lib/identity'
import { isOrganisationRole } from '@/lib/identity'

interface EntityAvatarProps {
  src?: string | null
  name?: string | null
  role?: RoleLike
  /** Outer size in px (Figma rows: 48, activity: 44, tab bar: 26). */
  size?: number
  className?: string
}

/**
 * Identity rule from 00 Architecture: people (players, coaches, umpires)
 * are circles with a photo; clubs and brands are rounded squares with the
 * crest/logo on white, never cropped. One component so every row, card and
 * header follows it.
 */
export function EntityAvatar({ src, name, role, size = 48, className }: EntityAvatarProps) {
  const label = name ?? ''
  if (isOrganisationRole(role)) {
    const radius = Math.round(size / 4)
    return (
      <span
        className={cn('flex shrink-0 items-center justify-center overflow-hidden border border-line bg-white', className)}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {src ? (
          <img
            src={src}
            alt={label}
            loading="lazy"
            className="object-contain"
            style={{ width: size - 8, height: size - 8 }}
          />
        ) : (
          <span className="text-secondary font-semibold text-ink-2">{getInitials(label) || '?'}</span>
        )}
      </span>
    )
  }
  return (
    <span className={cn('block shrink-0', className)} style={{ width: size, height: size }}>
      <Avatar
        src={src}
        alt={label}
        initials={getInitials(label) || '?'}
        role={role ?? undefined}
        className="!h-full !w-full"
      />
    </span>
  )
}
