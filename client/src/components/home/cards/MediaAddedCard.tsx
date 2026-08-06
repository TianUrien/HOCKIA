import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Images } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'
import type { MediaAddedFeedItem } from '@/types/homeFeed'

interface Props {
  item: MediaAddedFeedItem
}

function profilePathFor(role: string, id: string): string {
  if (role === 'club') return `/clubs/id/${id}?ref=feed`
  if (role === 'umpire') return `/umpires/id/${id}?ref=feed`
  return `/players/id/${id}?ref=feed`
}

/**
 * media_added — "New photos". A per-(uploader, day) aggregate: one card for a
 * bulk upload, with up to 4 sample thumbnails + a running count.
 */
export function MediaAddedCard({ item }: Props) {
  const timeAgo = getTimeAgo(item.created_at, true)
  const profilePath = profilePathFor(item.uploader_role, item.uploader_id)
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
    <div className="bg-white">
      <div className="p-5 pb-3">
        <Link to={profilePath} className="flex items-center gap-3 group">
          <Avatar
            src={item.uploader_avatar_url}
            initials={item.uploader_name?.slice(0, 2) || '?'}
            size="md"
            role={item.uploader_role}
            className="flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                {item.uploader_name || 'A member'}
              </span>
              <RoleBadge role={item.uploader_role} />
            </div>
            <p className="text-sm text-gray-500 flex items-center gap-1.5">
              <Images className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
              <span>
                Added {n} new {n === 1 ? 'photo' : 'photos'} &middot; {timeAgo}
              </span>
            </p>
          </div>
        </Link>
      </div>

      {urls.length > 0 && (
        <Link to={profilePath} className="block">
          <div className={`grid ${cols} gap-0.5`}>
            {urls.map((u, i) => (
              // Keyed by URL, not index: when a dead tile drops out, index
              // keys would remap the remaining URLs onto existing <img>
              // nodes (stale src / skipped error events).
              <div key={u} className="relative aspect-square bg-gray-100 overflow-hidden">
                <img
                  src={getImageUrl(u, 'feed-thumb') ?? undefined}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailedUrls((prev) => new Set(prev).add(u))}
                />
                {i === urls.length - 1 && extra > 0 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-lg font-semibold">
                    +{extra}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Link>
      )}
    </div>
  )
}
