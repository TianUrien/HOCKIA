import Avatar from '@/components/Avatar'
import { cn } from '@/lib/utils'
import type { RoleLike } from '@/lib/identity'
import { isOrganisationRole } from '@/lib/identity'
import RolePlaceholder from '@/components/RolePlaceholder'

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
    // Brands: rounded square (24 %). Clubs: the crest on white, or the
    // Avatar / Placeholder shield in a circle when there is none.
    const radius = !src && role !== 'brand' ? size / 2 : Math.round(size / 4)
    return (
      <span
        className={cn('flex shrink-0 items-center justify-center overflow-hidden', src ? 'border border-line bg-white' : '', className)}
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
          // No crest / logo: Avatar / Placeholder (never initials).
          <RolePlaceholder role={role === 'brand' ? 'brand' : 'club'} label="" />
        )}
      </span>
    )
  }
  return (
    <span className={cn('block shrink-0', className)} style={{ width: size, height: size }}>
      <Avatar
        src={src}
        alt={label}
        role={role ?? undefined}
        className="!h-full !w-full"
      />
    </span>
  )
}
