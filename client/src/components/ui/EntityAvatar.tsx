import Avatar from '@/components/Avatar'
import { cn } from '@/lib/utils'
import type { RoleLike } from '@/lib/identity'
import { isOrganisationRole } from '@/lib/identity'
import RolePlaceholder from '@/components/RolePlaceholder'
import { OrgLogo } from '@/components/ui/OrgLogo'

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
 * crest/logo on white (OrgLogo). One component so every row, card and
 * header follows it.
 */
export function EntityAvatar({ src, name, role, size = 48, className }: EntityAvatarProps) {
  const label = name ?? ''
  if (isOrganisationRole(role)) {
    // A crest or logo: THE organisation tile (OrgLogo). None yet: the
    // Avatar / Placeholder, a rounded square for brands and a circle for clubs.
    if (src) return <OrgLogo src={src} alt={label} role={role === 'brand' ? 'brand' : 'club'} className={className} style={{ width: size, height: size }} />
    return (
      <span
        className={cn('flex shrink-0 items-center justify-center overflow-hidden', className)}
        style={{ width: size, height: size, borderRadius: role === 'brand' ? Math.round(size / 4) : size / 2 }}
      >
        <RolePlaceholder role={role === 'brand' ? 'brand' : 'club'} label="" />
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
