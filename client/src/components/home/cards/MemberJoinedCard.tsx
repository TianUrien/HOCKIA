import { UserPlus } from 'lucide-react'
import { positionLabel } from '@/lib/identity'
import { NationalityCardDisplay } from '@/components'
import { FeedCard, FeedCardAction, FeedCardBody, FeedCardCaption, FeedCardFooter, FeedCardHeader, profilePathForRole } from '../FeedCard'
import type { MemberJoinedFeedItem } from '@/types/homeFeed'

interface MemberJoinedCardProps {
  item: MemberJoinedFeedItem
}

/**
 * member_joined — "Joined HOCKIA". The header owns club · city (author
 * context lookup), so the body only carries what the header can't:
 * nationality and position.
 */
export function MemberJoinedCard({ item }: MemberJoinedCardProps) {
  const profilePath = profilePathForRole(item.role, item.profile_id)
  const hasDetails = Boolean(item.nationality_country_id || item.position)

  return (
    <FeedCard testId="member-joined-card">
      <FeedCardHeader
        authorId={item.profile_id}
        name={item.full_name}
        avatarUrl={item.avatar_url}
        role={item.role}
        createdAt={item.created_at}
        profilePath={profilePath}
      />
      <FeedCardCaption icon={<UserPlus />}>Joined HOCKIA</FeedCardCaption>

      {hasDetails && (
        <FeedCardBody>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-gray-600">
            {item.nationality_country_id && (
              <NationalityCardDisplay primaryCountryId={item.nationality_country_id} />
            )}
            {item.position && <span>{positionLabel(item.position)}</span>}
          </div>
        </FeedCardBody>
      )}

      <FeedCardFooter>
        <FeedCardAction to={profilePath}>View profile</FeedCardAction>
      </FeedCardFooter>
    </FeedCard>
  )
}
