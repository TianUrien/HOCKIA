import { useState, useMemo } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { getImageUrl, AVATAR_SIZE_MAP } from '@/lib/imageUrl'
import { useProfileImagePreview } from './ProfileImagePreviewProvider'
import RolePlaceholder from './RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'

interface AvatarProps {
  src?: string | null
  alt?: string
  initials?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  loading?: 'lazy' | 'eager'
  /** Fetch-priority hint. Set 'high' (+ loading="eager") on the single
   *  above-the-fold header avatar of a route so it wins the LCP race.
   *  Leave unset everywhere else — feed/community/menu avatars stay lazy. */
  fetchPriority?: 'high' | 'low' | 'auto'
  enablePreview?: boolean
  previewTitle?: string
  previewInteraction?: 'auto' | 'pointer'
  /** When the user has no avatar uploaded AND we know their role, render a
   *  role-tinted RolePlaceholder instead of the generic initials block.
   *  Purely cosmetic — `profiles.avatar_url` is still NULL and every
   *  profile-strength scorer correctly counts the photo as missing. Pass
   *  the user's `role` when known; omit for contexts where role isn't in
   *  scope (chat counterparts not yet loaded, etc.) and the existing
   *  initials fallback will be used. */
  role?: string | null
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-3xl'
}

export default function Avatar({
  src,
  alt,
  initials,
  size = 'md',
  className,
  loading = 'lazy',
  fetchPriority,
  enablePreview = false,
  previewTitle,
  previewInteraction = 'auto',
  role,
}: AvatarProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  // When the image path doesn't render AND we know the role, swap the
  // generic purple/initials block for a role-tinted SVG placeholder.
  // Purely cosmetic — `profiles.avatar_url` is still NULL in the DB and
  // every profile-strength scorer correctly counts the photo as missing.
  const showRolePlaceholder = (!src || imageError) && isRoleAvatarRole(role)
  const { openPreview } = useProfileImagePreview()
  const canPreview = Boolean(enablePreview && src)

  const optimizedSrc = useMemo(
    () => getImageUrl(src, AVATAR_SIZE_MAP[size] ?? 'avatar-sm'),
    [src, size]
  )

  const triggerPreview = () => {
    if (!canPreview || !src) return
    openPreview({ src, alt, title: previewTitle || alt || initials || undefined })
  }

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canPreview) return
    event.preventDefault()
    event.stopPropagation()
    triggerPreview()
  }

  const handlePreviewKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canPreview) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      triggerPreview()
    }
  }

  const previewProps = canPreview
    ? previewInteraction === 'pointer'
      ? {
          onClick: handlePreviewClick,
        }
      : {
          role: 'button' as const,
          tabIndex: 0,
          onClick: handlePreviewClick,
          onKeyDown: handlePreviewKey,
          'aria-label': previewTitle || alt || 'Open profile image preview',
        }
    : {}

  return (
    <div
      className={cn(
        'relative aspect-square rounded-full overflow-hidden font-semibold text-white flex items-center justify-center flex-shrink-0',
        // When a RolePlaceholder will fill the box, skip the purple gradient
        // background so the role-tinted SVG isn't sandwiched on top of it.
        // Otherwise keep the legacy purple block as the bg for the initials
        // / "?" fallback (preserves prior look for callers without a role).
        !showRolePlaceholder && 'bg-gradient-to-br from-[#8026FA] to-[#924CEC]',
        canPreview &&
          (previewInteraction === 'auto'
            ? 'cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#8026FA]'
            : 'cursor-zoom-in'),
        sizeClasses[size],
        className
      )}
      {...previewProps}
    >
      {src && !imageError ? (
        <>
          {!imageLoaded && (
            <div className="absolute inset-0 bg-gray-200 animate-pulse" />
          )}
          <img
            src={optimizedSrc ?? undefined}
            alt={alt || 'Avatar'}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
              imageLoaded ? "opacity-100" : "opacity-0"
            )}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </>
      ) : showRolePlaceholder && isRoleAvatarRole(role) ? (
        // The accessible name is provided by the parent (e.g. a card or
        // button labelled with the user's name), so mark the SVG decorative.
        <RolePlaceholder role={role} label="" />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <span>?</span>
      )}
    </div>
  )
}
