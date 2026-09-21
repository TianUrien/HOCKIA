import { lazy, Suspense } from 'react'
import { Video } from 'lucide-react'
import { FeedCard, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import type { VideoAddedFeedItem } from '@/types/homeFeed'

// Signed Cloudflare Stream player — mints a playback token from video_id and
// enforces recruiters-only gating itself. Lazy so its player path stays off
// the entry bundle.
const NativeVideoPlayer = lazy(() => import('@/components/media/NativeVideoPlayer'))

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
        {item.title ? <span className="text-gray-500"> · {item.title}</span> : null}
      </FeedCardCaption>
      <FeedCardMedia>
        <Suspense fallback={<div className="aspect-video animate-pulse bg-gray-100" />}>
          <NativeVideoPlayer
            videoId={item.video_id}
            title={item.title ?? undefined}
            durationSeconds={item.duration_seconds}
          />
        </Suspense>
      </FeedCardMedia>
    </FeedCard>
  )
}
