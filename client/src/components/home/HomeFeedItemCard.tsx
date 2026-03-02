import { memo } from 'react'
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
} from './cards'

interface HomeFeedItemCardProps {
  item: HomeFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
}

export const HomeFeedItemCard = memo(function HomeFeedItemCard({ item, onLikeUpdate, onDelete }: HomeFeedItemCardProps) {
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
    case 'user_post':
      if (item.post_type === 'transfer' && item.metadata) {
        return <TransferAnnouncementCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
      }
      if (item.post_type === 'signing' && item.metadata) {
        return <SigningAnnouncementCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
      }
      return <UserPostCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
    default:
      return null
  }
})
