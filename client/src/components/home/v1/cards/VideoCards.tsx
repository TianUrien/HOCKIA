import { lazy, Suspense } from 'react'
import { formatActivityAge } from '@/lib/inboxTime'
import { shareLink } from '@/lib/homeEngagement'
import { profilePathForRole } from '@/lib/feedPaths'
import { FeedCardMenu } from '../FeedCardMenu'
import { PostHeader, ShareButton } from '../PostParts'
import type { VideoAddedFeedItem } from '@/types/homeFeed'

const NativeVideoPlayer = lazy(() => import('@/components/media/NativeVideoPlayer'))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A video with no title reaches the feed with its id in the title slot. */
function cleanTitle(item: VideoAddedFeedItem): string | null {
  return item.title && item.title !== item.video_id && !UUID_RE.test(item.title) ? item.title : null
}

function shareProfile(item: VideoAddedFeedItem) {
  return profilePathForRole(item.uploader_role, item.uploader_id) ?? '/home'
}

/**
 * Highlight (Figma 60:261) and Full match (60:330, ONLY when the player made
 * it public — get_home_feed_v2 enforces it). Play button + duration, tap
 * plays inline with sound, the native controls carry full screen (H8). No
 * autoplay (founder ruling 11 Oct). v1: Share only — likes and comments on
 * videos are PHASE 2 (spec 65:329).
 */
export function VideoCard({ item }: { item: VideoAddedFeedItem }) {
  const full = item.kind === 'full_match'
  const title = cleanTitle(item)
  const profilePath = profilePathForRole(item.uploader_role, item.uploader_id)
  const age = formatActivityAge(item.created_at)

  return (
    <article className="pb-[18px] pt-3.5" data-testid={full ? 'home-full-match-card' : 'home-highlight-card'}>
      <PostHeader
        authorId={item.uploader_id}
        name={item.uploader_name}
        avatarUrl={item.uploader_avatar_url}
        role={item.uploader_role}
        subtitle={full ? `Full match · public · ${age}` : `Highlight · ${age}`}
        profilePath={profilePath}
        menu={
          <FeedCardMenu
            authorId={item.uploader_id}
            authorName={item.uploader_name}
            sharePath={shareProfile(item)}
            report={{ subject: 'profile', contentId: null }}
          />
        }
      />
      <Suspense fallback={<div className={full ? 'aspect-video animate-pulse bg-surface-muted' : 'aspect-[4/5] animate-pulse bg-surface-muted'} />}>
        <NativeVideoPlayer
          videoId={item.video_id}
          title={title ?? undefined}
          durationSeconds={item.duration_seconds}
          feed={{ label: full ? 'FULL MATCH' : 'HIGHLIGHT', frameClassName: full ? 'aspect-video' : 'aspect-[4/5]', playSize: full ? 56 : 64 }}
        />
      </Suspense>
      {full && (
        // Uploader's title, never a score (no score data exists — ruling 11 Oct).
        <div className="flex items-center gap-2.5 px-4 pt-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-ink-1">{title ?? 'Full match'}</p>
          <p className="shrink-0 text-secondary text-ink-3">Public match</p>
        </div>
      )}
      {!full && title && <p className="px-4 pt-3 text-secondary text-ink-1">{title}</p>}
      <div className="flex items-center justify-end px-4 pt-1">
        <ShareButton onShare={() => void shareLink(shareProfile(item))} />
      </div>
    </article>
  )
}
