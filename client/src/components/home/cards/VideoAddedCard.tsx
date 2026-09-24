import { lazy, Suspense } from 'react'
import { Video } from 'lucide-react'
import { FeedCard, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import type { VideoAddedFeedItem } from '@/types/homeFeed'

// Signed Cloudflare Stream player — mints a playback token from video_id and
// enforces recruiters-only gating itself. Lazy so its player path stays off
// the entry bundle.
const NativeVideoPlayer = lazy(() => import('@/components/media/NativeVideoPlayer'))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  item: VideoAddedFeedItem
}

/**
 * video_added — "New highlight" / "Full match". One card per native
 * (Cloudflare Stream) player video that became ready + public. The card stores
 * only video_id; the player mints a signed poster + playback token at render,
 * so deleted/errored/now-private videos fail safe.
 */
export function VideoAddedCard({ item }: Props) {
  const label = item.kind === 'full_match' ? 'Full match' : 'New highlight'
  // A video with no title reaches the feed with its id in the title slot.
  // Never show an id: the label alone reads "New highlight" / "Full match".
  const title = item.title && item.title !== item.video_id && !UUID_RE.test(item.title) ? item.title : null

  return (
    <FeedCard testId="video-added-card">
      <FeedCardHeader
        authorId={item.uploader_id}
        name={item.uploader_name}
        avatarUrl={item.uploader_avatar_url}
        role={item.uploader_role}
        createdAt={item.created_at}
        profilePath={profilePathForRole(item.uploader_role, item.uploader_id)}
      />
      <FeedCardCaption icon={<Video />}>
        {label}
        {title ? <span className="text-gray-500"> · {title}</span> : null}
      </FeedCardCaption>
      <FeedCardMedia>
        <Suspense fallback={<div className="aspect-video animate-pulse bg-gray-100" />}>
          <NativeVideoPlayer
            videoId={item.video_id}
            title={title ?? undefined}
            durationSeconds={item.duration_seconds}
          />
        </Suspense>
      </FeedCardMedia>
    </FeedCard>
  )
}
