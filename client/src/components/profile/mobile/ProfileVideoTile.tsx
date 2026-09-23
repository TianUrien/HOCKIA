import { Lock, Play, VideoOff } from 'lucide-react'
import { useSignedVideoThumbnail } from '@/hooks/useSignedVideoThumbnail'
import { useNearViewport } from '@/hooks/useNearViewport'
import { cn } from '@/lib/utils'
import { formatVideoDuration } from '@/lib/videoCopy'

/**
 * One video tile for the profile (Video rows), Videos — all (grid) and Manage
 * media (cards). The signed thumbnail is minted 1.5 screens ahead of the
 * viewport (the first tiles of a screen eagerly), asked for at display size,
 * and fades in over a neutral surface — never a dark tile. Lock badge for
 * recruiters-only videos; "Video unavailable" only for a real dead asset.
 */
export type VideoTileData = { id: string; title: string; durationSeconds: number | null }

interface ProfileVideoTileProps {
  video: VideoTileData
  portrait?: boolean
  locked?: boolean
  /** The viewer may play a locked video (owner, club, coach). When false the
   *  thumbnail cannot be minted at all — that is a lock, not a dead asset. */
  canWatch?: boolean
  onOpen: () => void
  className?: string
  /** Small card thumbnail: play glyph only, no title, no lock badge. */
  compact?: boolean
  /** Above the fold: load now, and with high priority when `priority`. */
  eager?: boolean
  priority?: boolean
  /** CSS size of the box, for a right-sized thumbnail request. */
  size?: { width: number; height: number }
}

export function ProfileVideoTile({ video, portrait = false, locked = false, canWatch = true, onOpen, className, compact = false, eager = false, priority = false, size }: ProfileVideoTileProps) {
  const { ref, near } = useNearViewport<HTMLButtonElement>(eager || priority)
  const gated = locked && !canWatch
  const box = size ?? (portrait ? { width: 124, height: 164 } : { width: 224, height: 126 })
  const { thumb, loaded, onThumbError, onThumbLoad, unavailable } = useSignedVideoThumbnail(video.id, near && !gated, box)
  const dead = unavailable && !gated
  const dur = formatVideoDuration(video.durationSeconds)

  if (dead) {
    return (
      <button ref={ref} type="button" onClick={onOpen} aria-label={`${video.title} — video unavailable`} className={cn('relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-card bg-surface-grouped px-2 text-center', className)}>
        <VideoOff className="h-5 w-5 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
        <span className="text-caption text-ink-3">Video unavailable</span>
      </button>
    )
  }

  return (
    <button ref={ref} type="button" onClick={onOpen} aria-label={`${gated ? 'Locked: ' : 'Play '}${video.title}`} className={cn('relative overflow-hidden rounded-card bg-surface-grouped text-left', className)}>
      {thumb && (
        <img
          src={thumb}
          alt=""
          loading={eager || priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          onError={onThumbError}
          onLoad={onThumbLoad}
          className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ease-out', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {loaded && <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent" />}
      <span className={cn('absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-ink-1 transition-colors', loaded ? 'bg-white/95' : 'bg-white', compact ? 'h-8 w-8' : 'h-10 w-10')}><Play className={cn('ml-0.5 fill-current', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} /></span>
      {locked && !compact && <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><Lock className="h-3 w-3" strokeWidth={2.2} /></span>}
      {!portrait && !compact && <span className={cn('absolute bottom-2 left-2.5 right-14 truncate text-caption font-semibold', loaded ? 'text-white' : 'text-ink-1')}>{video.title}</span>}
      {dur && !compact && <span className={cn('absolute bottom-2 right-2 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold', loaded ? 'bg-black/55 text-white' : 'bg-white text-ink-1')}>{dur}</span>}
    </button>
  )
}
