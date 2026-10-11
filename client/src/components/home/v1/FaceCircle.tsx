import { useState } from 'react'
import { getImageUrl } from '@/lib/imageUrl'
import { initialsOf, roleGradient, type CommunityRole } from '@/lib/communityCard'
import { cn } from '@/lib/utils'

/**
 * A member's face in a circle. No photo → the Community no-photo treatment:
 * the role gradient (player blue · coach teal · umpire grey · brand) with
 * white initials — the same everywhere in the app (Figma Home review 11 Oct).
 */
export function FaceCircle({ url, name, role, className, initialsClassName = 'text-[15px]', size = 'avatar-md' }: {
  url: string | null | undefined
  name: string | null | undefined
  role?: string | null
  className?: string
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
        <span
          aria-hidden="true"
          className={cn('flex h-full w-full items-center justify-center font-semibold text-white', initialsClassName)}
          style={{ backgroundImage: roleGradient(((role as CommunityRole) || 'player')) }}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  )
}
