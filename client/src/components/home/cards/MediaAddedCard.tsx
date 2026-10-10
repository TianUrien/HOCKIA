import { useMemo, useState } from 'react'
import { Images } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import { useActivityPhotos } from '@/hooks/useActivityPhotos'
import { FeedCard, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import { MediaLightbox } from '../MediaLightbox'
import type { MediaAddedFeedItem, PostMediaItem } from '@/types/homeFeed'

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
 * author row. The viewer opens at once on the samples and switches to the
 * full set as soon as it loads (useActivityPhotos).
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
  // The photo the viewer was opened on (null = closed).
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const full = useActivityPhotos(item.uploader_id, item.day, openUrl !== null)
  const fullUrls = full.data && full.data.length > 0 ? full.data : null
  const viewerImages = useMemo<PostMediaItem[]>(
    () => (fullUrls ?? urls).map((url, order) => ({ url, media_type: 'image', order })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urls is derived each render; its content is what matters
    [fullUrls, urls.join('|')],
  )
  const viewerIndex = openUrl ? Math.max(0, viewerImages.findIndex((m) => m.url === openUrl)) : 0
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
              return (
                // Keyed by URL, not index: when a dead tile drops out, index
                // keys would remap the remaining URLs onto existing <img>
                // nodes (stale src / skipped error events).
                <button
                  key={u}
                  type="button"
                  onClick={() => setOpenUrl(u)}
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
                  {isMore && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
                      +{extra}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </FeedCardMedia>
      )}

      {openUrl !== null && viewerImages.length > 0 && (
        <MediaLightbox
          // Remount once the full set arrives so the viewer re-anchors on the
          // tapped photo inside the complete list.
          key={fullUrls ? 'full' : 'samples'}
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setOpenUrl(null)}
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
