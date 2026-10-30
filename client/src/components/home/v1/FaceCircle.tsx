import { useState } from 'react'
import { getImageUrl } from '@/lib/imageUrl'
import { cn } from '@/lib/utils'
import RolePlaceholder from '@/components/RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'

/**
 * A member's face in a circle. No photo → Avatar / Placeholder (the role
 * silhouette; never initials, founder 2026-10-26), the same everywhere.
 */
export function FaceCircle({ url, role, className, size = 'avatar-md' }: {
  url: string | null | undefined
  /** Kept for callers (and future alt text); not drawn: never initials. */
  name: string | null | undefined
  role?: string | null
  className?: string
  /** Kept for callers; unused since the placeholder has no letters. */
  initialsClassName?: string
  size?: 'avatar-sm' | 'avatar-md' | 'avatar-lg'
}) {
  const [failed, setFailed] = useState(false)
  const src = url && !failed ? getImageUrl(url, size) ?? url : null
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full', className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <RolePlaceholder role={isRoleAvatarRole(role) ? role : 'player'} label="" />
      )}
    </span>
  )
}
