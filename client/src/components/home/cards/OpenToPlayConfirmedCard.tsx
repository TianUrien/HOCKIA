import { BadgeCheck } from 'lucide-react'
import { positionLabel } from '@/lib/identity'
import { NationalityCardDisplay } from '@/components'
import { FeedCard, FeedCardAction, FeedCardBody, FeedCardCaption, FeedCardFooter, FeedCardHeader, profilePathForRole } from '../FeedCard'
import type { OpenToPlayConfirmedFeedItem } from '@/types/homeFeed'

interface Props {
  item: OpenToPlayConfirmedFeedItem
}

/**
 * open_to_play_confirmed — "Open to play". A profile spotlight: the player
 * actively confirmed they're still available. One refreshing card per player
 * (never stacks), so it reads as a live availability signal.
 */
export function OpenToPlayConfirmedCard({ item }: Props) {
  const profilePath = profilePathForRole(item.player_role, item.player_id)
  const hasDetails = Boolean(item.country_id || item.position || item.open_to_opportunities)

  return (
    <FeedCard testId="open-to-play-confirmed-card">
      <FeedCardHeader
        authorId={item.player_id}
        name={item.player_name}
        avatarUrl={item.player_avatar_url}
        role={item.player_role}
        createdAt={item.created_at}
        profilePath={profilePath}
      />
      <FeedCardCaption icon={<BadgeCheck />}>Open to play</FeedCardCaption>

      {hasDetails && (
        <FeedCardBody>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-gray-600">
            {item.country_id && <NationalityCardDisplay primaryCountryId={item.country_id} />}
            {item.position && <span>{positionLabel(item.position)}</span>}
            {item.open_to_opportunities && (
              <span className="inline-flex items-center rounded-full bg-hockia-primary/10 px-2 py-0.5 text-xs font-medium text-hockia-primary">
                Open to opportunities
              </span>
            )}
          </div>
        </FeedCardBody>
      )}

      <FeedCardFooter>
        <FeedCardAction to={profilePath}>View profile</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
