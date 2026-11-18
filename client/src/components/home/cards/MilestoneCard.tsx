import { useState } from 'react'
import { Image, CheckCircle, Shield, Video } from 'lucide-react'
import { StorageImage } from '@/components'
import { MediaLightbox } from '../MediaLightbox'
import { FeedCard, FeedCardAction, FeedCardCaption, FeedCardFooter, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import type { MilestoneAchievedFeedItem, MilestoneType } from '@/types/homeFeed'
import { useHomeT } from '@/i18n/ns/home'

interface MilestoneCardProps {
  item: MilestoneAchievedFeedItem
}

// `label` is a catalog key; it is translated where the card renders.
const MILESTONE_CONFIG = {
  first_gallery_image: { icon: Image, label: 'cards.milestone.firstGalleryImage' },
  // Trigger fires when highlight_video_url goes NULL → value — a player adding
  // video evidence for the first time is exactly the moment to celebrate.
  first_video: { icon: Video, label: 'cards.milestone.firstVideo' },
  profile_100_percent: { icon: CheckCircle, label: 'cards.milestone.profileComplete' },
  first_reference_received: { icon: Shield, label: 'cards.milestone.firstReference' },
} as const satisfies Record<MilestoneType, { icon: typeof Image; label: string }>

export function MilestoneCard({ item }: MilestoneCardProps) {
  const t = useHomeT()
  const [mediaError, setMediaError] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
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
      <FeedCardCaption icon={<Icon />}>{t(config.label)}</FeedCardCaption>

      {item.milestone_type === 'first_gallery_image' && item.image_url && (
        <FeedCardMedia>
          {/* Tap to enlarge in the photo viewer; the profile stays on the
              name, the avatar and "View profile". */}
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label={t('cards.milestone.viewPhoto')}
            className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
          >
            <StorageImage
              src={item.image_url}
              imageSize="feed-full"
              alt={t('cards.milestone.galleryAlt')}
              className="h-full w-full object-cover"
              containerClassName="aspect-[4/3]"
              fallbackClassName="h-48"
              onImageError={() => setMediaError(true)}
            />
          </button>
        </FeedCardMedia>
      )}

      {viewerOpen && item.image_url && (
        <MediaLightbox
          images={[{ url: item.image_url, media_type: 'image', order: 0 }]}
          initialIndex={0}
          onClose={() => setViewerOpen(false)}
          author={{
            id: item.profile_id,
            name: item.full_name,
            avatarUrl: item.avatar_url,
            role: item.role,
            profilePath,
          }}
        />
      )}

      <FeedCardFooter>
        <FeedCardAction to={profilePath}>{t('cards.milestone.viewProfile')}</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
