import { useEffect, useRef, useState } from 'react'
import { Lock, Play, VideoOff } from 'lucide-react'
import { useSignedVideoThumbnail } from '@/hooks/useSignedVideoThumbnail'
import { cn } from '@/lib/utils'
import { formatVideoDuration } from '@/lib/videoCopy'

/**
 * One video tile for the profile (Video rows) and Videos — all (grid).
 * Signed thumbnail minted when the tile nears the viewport; lock badge for
 * recruiters-only videos; and a neutral "Video unavailable" placeholder when
 * the asset is dead (Cloudflare 404) — dead data must read as dead data,
 * never as a broken black tile.
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
}

export function ProfileVideoTile({ video, portrait = false, locked = false, canWatch = true, onOpen, className }: ProfileVideoTileProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const gated = locked && !canWatch
  const { thumb, onThumbError, onThumbLoad, unavailable } = useSignedVideoThumbnail(video.id, inView && !gated)
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
    <button ref={ref} type="button" onClick={onOpen} aria-label={`${gated ? 'Locked: ' : 'Play '}${video.title}`} className={cn('relative overflow-hidden rounded-card bg-ink-1 text-left', className)}>
      {thumb && <img src={thumb} alt="" onError={onThumbError} onLoad={onThumbLoad} className="absolute inset-0 h-full w-full object-cover" />}
      <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-ink-1"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
      {locked && <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><Lock className="h-3 w-3" strokeWidth={2.2} /></span>}
      {!portrait && <span className="absolute bottom-2 left-2.5 right-14 truncate text-caption font-semibold text-white">{video.title}</span>}
      {dur && <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">{dur}</span>}
    </button>
  )
}
