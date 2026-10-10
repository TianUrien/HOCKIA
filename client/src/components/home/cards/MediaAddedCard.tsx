import { useEffect, useMemo, useState } from 'react'
import { Images, Loader2 } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import { useActivityPhotos } from '@/hooks/useActivityPhotos'
import { FeedCard, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import { MediaLightbox } from '../MediaLightbox'
import type { MediaAddedFeedItem, PostMediaItem } from '@/types/homeFeed'

/** Longest the tapped tile waits for the full set before the viewer opens on
 *  the visible samples instead. */
const VIEWER_WAIT_MS = 2500

interface Props {
  item: MediaAddedFeedItem
}

/**
 * media_added — "Added N new photos". A per-(uploader, day) aggregate: one
 * card for a bulk upload, with up to 4 sample thumbnails + a running count.
 *
 * Tapping a thumbnail (or the "+N" tile) opens the photo viewer on that photo
 * and lets the member swipe through ALL N photos without leaving Home; the
 * profile stays one tap away through the name, the avatar and the viewer's
 * author row. The tapped tile shows a spinner while the full set loads
 * (useActivityPhotos, usually well under a second), so the viewer opens once,
 * on the right photo, with the right count; if loading fails or stalls it
 * opens on the visible samples instead.
 */
export function MediaAddedCard({ item }: Props) {
  const profilePath = profilePathForRole(item.uploader_role, item.uploader_id)
  // Tiles whose image failed to load are dropped from the grid entirely —
  // a dead sample URL (photo deleted after upload; DB-side cleanup can
  // still be raced by CDN caching) must not render a broken-image glyph
  // on Home (prod incident 2026-08-07).
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set())
  const urls = (item.sample_urls ?? []).slice(0, 4).filter((u) => !failedUrls.has(u))
  const n = item.count ?? urls.length
  const extra = n - urls.length
  // The tile the member tapped (null = nothing requested) and whether the
  // viewer is showing. Requesting starts the full-set fetch; the viewer
  // shows once it has settled, or after VIEWER_WAIT_MS at the latest.
  const [tappedUrl, setTappedUrl] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const full = useActivityPhotos(item.uploader_id, item.day, tappedUrl !== null)
  const settled = full.isSuccess || full.isError || stalled
  const viewerOpen = tappedUrl !== null && settled
  useEffect(() => {
    if (tappedUrl === null || settled) return
    const t = window.setTimeout(() => setStalled(true), VIEWER_WAIT_MS)
    return () => window.clearTimeout(t)
  }, [tappedUrl, settled])
  const close = () => {
    setTappedUrl(null)
    setStalled(false)
  }
  // Full set when it loaded (minus tiles already known to be dead), else the
  // visible samples.
  const fullUrls = full.data?.filter((u) => !failedUrls.has(u)) ?? []
  const sourceUrls = fullUrls.length > 0 ? fullUrls : urls
  // Content key: the arrays are rebuilt every render, the list rarely changes.
  const sourceKey = JSON.stringify(sourceUrls)
  const viewerImages = useMemo<PostMediaItem[]>(
    () => (JSON.parse(sourceKey) as string[]).map((url, order) => ({ url, media_type: 'image', order })),
    [sourceKey],
  )
  const viewerIndex = tappedUrl ? Math.max(0, viewerImages.findIndex((m) => m.url === tappedUrl)) : 0
  const cols =
    urls.length >= 4 ? 'grid-cols-4'
    : urls.length === 3 ? 'grid-cols-3'
    : urls.length === 2 ? 'grid-cols-2'
    : 'grid-cols-1'

  return (
    <FeedCard testId="media-added-card">
      <FeedCardHeader
        authorId={item.uploader_id}
        name={item.uploader_name}
        avatarUrl={item.uploader_avatar_url}
        role={item.uploader_role}
        createdAt={item.created_at}
        profilePath={profilePath}
      />
      <FeedCardCaption icon={<Images />}>
        Added {n} new {n === 1 ? 'photo' : 'photos'}
      </FeedCardCaption>

      {urls.length > 0 && (
        <FeedCardMedia>
          <div className={`grid ${cols} gap-0.5`}>
            {urls.map((u, i) => {
              const isMore = i === urls.length - 1 && extra > 0
              const loading = tappedUrl === u && !viewerOpen
              return (
                // Keyed by URL, not index: when a dead tile drops out, index
                // keys would remap the remaining URLs onto existing <img>
                // nodes (stale src / skipped error events).
                <button
                  key={u}
                  type="button"
                  onClick={() => setTappedUrl(u)}
                  aria-busy={loading || undefined}
                  aria-label={isMore ? `View all ${n} photos` : `View photo ${i + 1} of ${n}`}
                  className="relative block aspect-square overflow-hidden bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
                >
                  <img
                    src={getImageUrl(u, 'feed-thumb') ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedUrls((prev) => new Set(prev).add(u))}
                  />
                  {isMore && !loading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
                      +{extra}
                    </span>
                  )}
                  {loading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                      <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </FeedCardMedia>
      )}

      {viewerOpen && viewerImages.length > 0 && (
        <MediaLightbox
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={close}
          author={{
            id: item.uploader_id,
            name: item.uploader_name,
            avatarUrl: item.uploader_avatar_url,
            role: item.uploader_role,
            profilePath,
          }}
        />
      )}
    </FeedCard>
  )
}
