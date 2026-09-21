import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Images } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import { FeedCard, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import type { MediaAddedFeedItem } from '@/types/homeFeed'

interface Props {
  item: MediaAddedFeedItem
}

/**
 * media_added — "Added N new photos". A per-(uploader, day) aggregate: one
 * card for a bulk upload, with up to 4 sample thumbnails + a running count.
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
          <Link to={profilePath} className="block" aria-label={`See all ${n} photos`}>
            <div className={`grid ${cols} gap-0.5`}>
              {urls.map((u, i) => (
                // Keyed by URL, not index: when a dead tile drops out, index
                // keys would remap the remaining URLs onto existing <img>
                // nodes (stale src / skipped error events).
                <div key={u} className="relative aspect-square overflow-hidden bg-gray-100">
                  <img
                    src={getImageUrl(u, 'feed-thumb') ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedUrls((prev) => new Set(prev).add(u))}
                  />
                  {i === urls.length - 1 && extra > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
                      +{extra}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Link>
        </FeedCardMedia>
      )}
    </FeedCard>
  )
}
