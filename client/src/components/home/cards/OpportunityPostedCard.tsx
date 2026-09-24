import { useState } from 'react'
import { Briefcase, MapPin, BadgeCheck } from 'lucide-react'
import { StorageImage } from '@/components'
import { FeedCard, FeedCardBody, FeedCardCaption, FeedCardFooter, FeedCardHeader, FeedCardPrimaryAction, profilePathForRole } from '../FeedCard'
import type { OpportunityPostedFeedItem } from '@/types/homeFeed'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import OpportunityDetailOverlay from '@/components/OpportunityDetailOverlay'

interface OpportunityPostedCardProps {
  item: OpportunityPostedFeedItem
}

export function OpportunityPostedCard({ item }: OpportunityPostedCardProps) {
  // Open the opportunity as an overlay over the Home feed (the feed stays
  // mounted underneath, so closing reveals it exactly where it was — no route
  // change, no unmount, no scroll jump). Deep links still use the route.
  const [showDetail, setShowDetail] = useState(false)

  // The PUBLISHER is the card's author. Vacancies can be coach-published —
  // then club_id/club_name/club_logo carry the COACH's profile.
  const publisherRole = item.publisher_role === 'coach' ? 'coach' : 'club'
  const publisherPath = profilePathForRole(publisherRole, item.club_id)

  // Players never see match or fit scores, anywhere (founder ruling
  // 2026-09-24). The card carries the role's facts only.
  const hasChips = Boolean(item.position || item.gender || item.location_city || item.location_country)

  return (
    <FeedCard testId="opportunity-posted-card">
      <FeedCardHeader
        authorId={item.club_id}
        name={item.club_name}
        avatarUrl={item.club_logo}
        role={publisherRole}
        createdAt={item.created_at}
        profilePath={publisherPath}
      />
      <FeedCardCaption icon={<Briefcase />}>New opportunity</FeedCardCaption>

      <FeedCardBody>
        <h3 className="text-[17px] font-semibold leading-6 text-gray-900">{item.title}</h3>

        {hasChips && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            {item.position && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {item.position}
              </span>
            )}
            {item.gender && (
              <span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-pink-700">
                {opportunityGenderToTeamLabel(item.gender)}
              </span>
            )}
            {(item.location_city || item.location_country) && (
              <span className="flex items-center gap-1 text-[13px] text-gray-500">
                <MapPin className="h-3.5 w-3.5" />
                {[item.location_city, item.location_country].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        )}

        {/* Coach-published on behalf of a world club — the club is named as
            the official home of the role. */}
        {item.publisher_role === 'coach' && item.world_club_name && (
          <div className="mt-2 flex items-center gap-2">
            {item.world_club_avatar ? (
              <StorageImage
                src={item.world_club_avatar}
                imageSize="card-thumb"
                alt={item.world_club_name}
                className="h-5 w-5 rounded-full object-cover flex-shrink-0"
                containerClassName="h-5 w-5 flex-shrink-0"
              />
            ) : (
              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-orange-200 bg-orange-50">
                <span className="text-[7px] font-bold text-orange-600">
                  {item.world_club_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </span>
              </div>
            )}
            <span className="text-[13px] text-gray-500">{item.world_club_name}</span>
            <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-100 bg-[#FFF7ED] px-1.5 py-0.5 text-[9px] font-semibold text-[#c2410c]">
              <BadgeCheck className="h-2.5 w-2.5" />
              Official
            </span>
          </div>
        )}
      </FeedCardBody>

      <FeedCardFooter>
        <FeedCardPrimaryAction onClick={() => setShowDetail(true)}>Apply</FeedCardPrimaryAction>
      </FeedCardFooter>

      {showDetail && (
        <OpportunityDetailOverlay
          opportunityId={item.opportunity_id}
          onClose={() => setShowDetail(false)}
        />
      )}
    </FeedCard>
  )
}
