import { useEffect, useMemo, useRef, useState } from 'react'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from '../BlurImage'
import { useActivityPhotos } from '@/hooks/useActivityPhotos'
import { formatActivityAge } from '@/lib/inboxTime'
import { profilePathForRole } from '@/lib/feedPaths'
import { shareLink } from '@/lib/homeEngagement'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { cn } from '@/lib/utils'
import { FeedCardMenu } from '../FeedCardMenu'
import { GlassChip } from '../primitives'
import { PostHeader, ShareButton } from '../PostParts'
import type { MediaAddedFeedItem, PostMediaItem } from '@/types/homeFeed'

const MAX_DOTS = 5

/**
 * Photos (Figma 60:392): one card per uploader per UTC day, an inline 4:5
 * carousel — swipe, the next photo peeks, a 1/N chip and dots. Tap opens the
 * photo viewer (H7) on that photo. v1: Share only (likes on photos: PHASE 2).
 */
export function PhotosCard({ item }: { item: MediaAddedFeedItem }) {
  const profilePath = profilePathForRole(item.uploader_role, item.uploader_id)
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [index, setIndex] = useState(0)
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  // The full set is fetched only when the card's samples don't already hold
  // every photo, and only once the card is near the screen — fetching every
  // card's set on load was one request per card (Sentry N+1, 2026-10-19).
  const needsFull = (item.count ?? 0) > (item.sample_urls?.length ?? 0)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = cardRef.current
    if (!needsFull || near || !el) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true) }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [needsFull, near])
  const full = useActivityPhotos(item.uploader_id, item.day, needsFull && (near || viewerAt !== null))

  const urls = useMemo(() => {
    const src = full.data && full.data.length > 0 ? full.data : item.sample_urls ?? []
    return src.filter((u) => !failed.has(u))
  }, [full.data, item.sample_urls, failed])
  const n = Math.max(urls.length, 0)
  const viewerImages = useMemo<PostMediaItem[]>(() => urls.map((url, order) => ({ url, media_type: 'image', order })), [urls])

  if (n === 0) return null

  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    const slide = el.firstElementChild as HTMLElement | null
    const w = slide ? slide.offsetWidth + 4 : el.clientWidth
    setIndex(Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / w))))
  }

  const count = item.count ?? n
  const dotStart = Math.min(Math.max(0, index - Math.floor(MAX_DOTS / 2)), Math.max(0, n - MAX_DOTS))
  const dots = Array.from({ length: Math.min(n, MAX_DOTS) }, (_, i) => dotStart + i)

  return (
    <article ref={cardRef} className="py-4" data-testid="home-photos-card">
      <PostHeader
        authorId={item.uploader_id}
        name={item.uploader_name}
        avatarUrl={item.uploader_avatar_url}
        role={item.uploader_role}
        subtitle={`Added ${count} ${count === 1 ? 'photo' : 'photos'} · ${formatActivityAge(item.created_at)}`}
        profilePath={profilePath}
        menu={<FeedCardMenu authorId={item.uploader_id} authorName={item.uploader_name} sharePath={profilePath ?? '/home'} report={{ subject: 'profile', contentId: null }} />}
      />
      <div className="relative">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {urls.map((u, i) => (
            <button
              key={u}
              type="button"
              onClick={() => setViewerAt(i)}
              aria-label={`Photo ${i + 1} of ${n}`}
              className={cn('relative aspect-[361/460] shrink-0 snap-start overflow-hidden bg-surface-muted', n > 1 ? 'w-[calc(100%-32px)]' : 'w-full')}
            >
              <BlurImage
                src={getImageUrl(u, 'feed-full') ?? u}
                lqip={getLqipUrl(u)}
                eager={i < 2}
                className="h-full w-full"
                onError={() => setFailed((prev) => new Set(prev).add(u))}
              />
            </button>
          ))}
        </div>
        {n > 1 && <GlassChip className="absolute right-11 top-3">{index + 1}/{n}</GlassChip>}
      </div>
      {n > 1 && (
        <div className="flex items-center justify-center gap-[5px] pt-2.5" aria-hidden="true">
          {dots.map((d) => (
            <span key={d} className={cn('rounded-full', d === index ? 'h-[7px] w-[7px] bg-ink-1' : 'h-1.5 w-1.5 bg-ink-4')} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-end px-4 pt-1">
        <ShareButton onShare={() => void shareLink(profilePath ?? '/home')} />
      </div>

      {viewerAt !== null && (
        <MediaLightbox
          images={viewerImages}
          initialIndex={viewerAt}
          onClose={() => setViewerAt(null)}
          author={{ id: item.uploader_id, name: item.uploader_name, avatarUrl: item.uploader_avatar_url, role: item.uploader_role, profilePath }}
          onShare={() => void shareLink(profilePath ?? '/home')}
        />
      )}
    </article>
  )
}
