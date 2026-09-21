import { useState } from 'react'
import { Briefcase, MapPin, BadgeCheck } from 'lucide-react'
import { StorageImage } from '@/components'
import { FeedCard, FeedCardBody, FeedCardCaption, FeedCardFooter, FeedCardHeader, FeedCardPrimaryAction, profilePathForRole } from '../FeedCard'
import type { OpportunityPostedFeedItem } from '@/types/homeFeed'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import OpportunityDetailOverlay from '@/components/OpportunityDetailOverlay'
import { useAuthStore } from '@/lib/auth'
import { computeOpportunityMatch, MATCH_THRESHOLD } from '@/lib/opportunityMatch'
import { isEuCountryCode, useCountries } from '@/hooks/useCountries'

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

  // §2.6 inline match % for PLAYER viewers — the same rule-based scorer as
  // the Pulse rail, over the fields the feed item carries (position +
  // category; level_sought/position_required are absent from older items'
  // metadata and are SKIPPED, not zeroed — honest absence). Shown only at
  // ≥ threshold, per the never-a-lonely-low-% rule.
  const profile = useAuthStore((s) => s.profile)
  const { getCountryById } = useCountries()
  const itemWithIntent = item as typeof item & {
    level_sought?: string | null
    position_required?: boolean | null
    eu_passport_required?: boolean | null
  }
  // EU hard gate (audit F3), same missing-data-never-blocks semantics as
  // checkOpportunityEligibility: only suppress when the role requires an EU
  // passport AND the viewer's known nationalities are all non-EU. Items
  // predating the metadata extension lack the key (no gate — ages out).
  const euBlocked = (() => {
    if (itemWithIntent.eu_passport_required !== true || !profile) return false
    const codes = [profile.nationality_country_id, (profile as { nationality2_country_id?: number | null }).nationality2_country_id]
      .filter((id): id is number => typeof id === 'number')
      .map((id) => getCountryById(id)?.code)
      .filter((c): c is string => Boolean(c))
    return codes.length > 0 && !codes.some(isEuCountryCode)
  })()
  const matchPct =
    profile?.role === 'player' && item.opportunity_type !== 'coach'
      ? computeOpportunityMatch(
          {
            position: profile.position ?? null,
            secondary_position: profile.secondary_position ?? null,
            playing_category: profile.playing_category ?? null,
            gender: profile.gender ?? null,
            level_target: profile.level_target ?? null,
          },
          {
            position: item.position,
            gender: item.gender,
            level_sought: itemWithIntent.level_sought ?? null,
            position_required: itemWithIntent.position_required ?? null,
          },
        )
      : null
  const showMatch = matchPct != null && matchPct >= MATCH_THRESHOLD && !euBlocked

  const hasChips = Boolean(item.position || item.gender || showMatch || item.location_city || item.location_country)

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
            {showMatch && (
              <span className="rounded-full bg-[#f4f0fd] px-2.5 py-1 text-xs font-bold text-hockia-primary">
                {matchPct}% match
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
