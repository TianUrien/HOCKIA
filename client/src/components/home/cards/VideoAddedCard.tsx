import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Video } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { VideoAddedFeedItem } from '@/types/homeFeed'

// Signed Cloudflare Stream player — mints a playback token from video_id and
// enforces recruiters-only gating itself. Lazy so its hls.js path stays off
// the entry bundle. (v1: one token mint per mounted video card — video volume
// is low; wrap in an in-view lazy-mount if that grows.)
const NativeVideoPlayer = lazy(() => import('@/components/media/NativeVideoPlayer'))

interface Props {
  item: VideoAddedFeedItem
}

function profilePathFor(role: string, id: string): string {
  if (role === 'club') return `/clubs/id/${id}?ref=feed`
  if (role === 'umpire') return `/umpires/id/${id}?ref=feed`
  return `/players/id/${id}?ref=feed`
}

/**
 * video_added — "New highlight" / "Full match". One card per native
 * (Cloudflare Stream) player video that became ready + public. The card stores
 * only video_id; the player mints a signed poster + playback token at render,
 * so deleted/errored/now-private videos fail safe.
 */
export function VideoAddedCard({ item }: Props) {
  const timeAgo = getTimeAgo(item.created_at, true)
  const profilePath = profilePathFor(item.uploader_role, item.uploader_id)
  const label = item.kind === 'full_match' ? 'Full match' : 'New highlight'

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
                {item.uploader_name || 'A player'}
              </span>
              <RoleBadge role={item.uploader_role} />
            </div>
            <p className="text-sm text-gray-500 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-[#8026FA] flex-shrink-0" />
              <span>
                <span className="font-medium text-[#8026FA]">{label}</span> &middot; {timeAgo}
              </span>
            </p>
          </div>
        </Link>
        {/* Title is rendered by NativeVideoPlayer on the poster — don't repeat it here. */}
      </div>

      <div className="px-3 pb-3">
        <Suspense fallback={<div className="aspect-video rounded-xl bg-gray-100 animate-pulse" />}>
          <NativeVideoPlayer
            videoId={item.video_id}
            title={item.title ?? undefined}
            durationSeconds={item.duration_seconds}
          />
        </Suspense>
      </div>
    </div>
  )
}
