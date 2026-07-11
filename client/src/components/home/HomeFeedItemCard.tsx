import { memo } from 'react'
import * as Sentry from '@sentry/react'
import { useImpressionOnce, recordPostImpression } from '@/lib/homeInstrumentation'
import type { HomeFeedItem } from '@/types/homeFeed'
import {
  MemberJoinedCard,
  OpportunityPostedCard,
  MilestoneCard,
  ReferenceReceivedCard,
  BrandPostCard,
  BrandProductCard,
  UserPostCard,
  TransferAnnouncementCard,
  SigningAnnouncementCard,
  ClubRespondedCard,
  MediaAddedCard,
  VideoAddedCard,
  OpenToPlayConfirmedCard,
} from './cards'

interface HomeFeedItemCardProps {
  item: HomeFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
}

// Module-level set so we only report each unknown item_type once per session
// (Sentry rate-limits + we don't want hundreds of duplicates if a feed page
// returns 20 unknown items).
const reportedUnknownTypes = new Set<string>()

/** Viewport-gated post_impression (Home redesign §4): fires once per post per
 *  session when the card nears the viewport. Feeds creator-side stats and the
 *  future Brand reach module. Wraps ONLY post-type items — activity cards
 *  (member_joined, media_added, …) are not "content" in the reach sense. */
function PostImpressionSentinel({ postId, children }: { postId: string; children: React.ReactNode }) {
  const ref = useImpressionOnce(() => recordPostImpression(postId))
  return <div ref={ref}>{children}</div>
}

export const HomeFeedItemCard = memo(function HomeFeedItemCard({ item, onLikeUpdate, onDelete }: HomeFeedItemCardProps) {
  const rendered = renderFeedItem(item, onLikeUpdate, onDelete)
  if (rendered && (item.item_type === 'user_post' || item.item_type === 'brand_post')) {
    const postId = (item as { post_id?: string }).post_id
    if (postId) {
      return <PostImpressionSentinel postId={postId}>{rendered}</PostImpressionSentinel>
    }
  }
  return rendered
})

function renderFeedItem(
  item: HomeFeedItem,
  onLikeUpdate?: HomeFeedItemCardProps['onLikeUpdate'],
  onDelete?: HomeFeedItemCardProps['onDelete'],
) {
  switch (item.item_type) {
    case 'member_joined':
      return <MemberJoinedCard item={item} />
    case 'opportunity_posted':
      return <OpportunityPostedCard item={item} />
    case 'milestone_achieved':
      return <MilestoneCard item={item} />
    case 'reference_received':
      return <ReferenceReceivedCard item={item} />
    case 'brand_post':
      return <BrandPostCard item={item} />
    case 'brand_product':
      return <BrandProductCard item={item} />
    case 'club_responded':
      return <ClubRespondedCard item={item} />
    case 'media_added':
      return <MediaAddedCard item={item} />
    case 'video_added':
      return <VideoAddedCard item={item} />
    case 'open_to_play_confirmed':
      return <OpenToPlayConfirmedCard item={item} />
    case 'user_post':
      if (item.post_type === 'transfer' && item.metadata) {
        return <TransferAnnouncementCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
      }
      if (item.post_type === 'signing' && item.metadata) {
        return <SigningAnnouncementCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
      }
      return <UserPostCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
    default: {
      // Surface unknown item types to Sentry — otherwise a backend-led
      // schema additions (e.g. a new event type shipped before the
      // client) would silently drop items with no visible signal.
      const unknownType = (item as { item_type?: string }).item_type ?? '<missing>'
      if (!reportedUnknownTypes.has(unknownType)) {
        reportedUnknownTypes.add(unknownType)
        Sentry.captureMessage('home_feed.unknown_item_type', {
          level: 'warning',
          tags: { feature: 'home_feed', item_type: unknownType },
          extra: {
            feed_item_id: (item as { feed_item_id?: string }).feed_item_id,
          },
        })
      }
      return null
    }
  }
}
