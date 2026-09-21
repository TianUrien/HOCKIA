import { useState } from 'react'
import { Image, CheckCircle, Shield, Video } from 'lucide-react'
import { StorageImage } from '@/components'
import { FeedCard, FeedCardAction, FeedCardCaption, FeedCardFooter, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import type { MilestoneAchievedFeedItem, MilestoneType } from '@/types/homeFeed'

interface MilestoneCardProps {
  item: MilestoneAchievedFeedItem
}

const MILESTONE_CONFIG: Record<MilestoneType, { icon: typeof Image; label: string }> = {
  first_gallery_image: { icon: Image, label: 'Added their first gallery photos' },
  // Trigger fires when highlight_video_url goes NULL → value — a player adding
  // video evidence for the first time is exactly the moment to celebrate.
  first_video: { icon: Video, label: 'Added their first highlight video' },
  profile_100_percent: { icon: CheckCircle, label: 'Completed their profile' },
  first_reference_received: { icon: Shield, label: 'Received their first reference' },
}

export function MilestoneCard({ item }: MilestoneCardProps) {
  const [mediaError, setMediaError] = useState(false)
  const config = MILESTONE_CONFIG[item.milestone_type]

  // Unknown milestone type — don't render
  if (!config) return null
  // Media failed to load — hide entire card
  if (mediaError) return null

  const Icon = config.icon
  const profilePath = profilePathForRole(item.role, item.profile_id)

  return (
    <FeedCard testId="milestone-card">
      <FeedCardHeader
        authorId={item.profile_id}
        name={item.full_name}
        avatarUrl={item.avatar_url}
        role={item.role}
        createdAt={item.created_at}
        profilePath={profilePath}
      />
      <FeedCardCaption icon={<Icon />}>{config.label}</FeedCardCaption>

      {item.milestone_type === 'first_gallery_image' && item.image_url && (
        <FeedCardMedia>
          <StorageImage
            src={item.image_url}
            imageSize="feed-full"
            alt="Gallery"
            className="h-full w-full object-cover"
            containerClassName="aspect-[4/3]"
            fallbackClassName="h-48"
            onImageError={() => setMediaError(true)}
          />
        </FeedCardMedia>
      )}

      <FeedCardFooter>
        <FeedCardAction to={profilePath}>View profile</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
