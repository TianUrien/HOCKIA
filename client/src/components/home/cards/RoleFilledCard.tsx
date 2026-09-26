import { CheckCircle2, BadgeCheck } from 'lucide-react'
import { positionLabel } from '@/lib/identity'
import { FeedCard, FeedCardBody, FeedCardCaption, FeedCardHeader, profilePathForRole } from '../FeedCard'
import type { RoleFilledFeedItem } from '@/types/homeFeed'

interface RoleFilledCardProps {
  item: RoleFilledFeedItem
}

/**
 * "Role filled" feed card (Home redesign Phase 1) — the market-moves FOMO
 * signal Phase 0's generator accumulates. Fires only on the club's explicit
 * "Mark as filled", so a "filled" story is always a real one (Q5: clean data
 * over proxy). "via HOCKIA" badge only when the club said the hire came
 * through the platform.
 */
export function RoleFilledCard({ item }: RoleFilledCardProps) {
  // Vacancies can be coach-published — then club_id/club_name carry the
  // COACH's profile; route + avatar tint by author_role ('club' fallback
  // covers cached pre-migration payloads).
  const publisherRole = item.author_role === 'coach' ? 'coach' : 'club'
  const publisherPath = profilePathForRole(publisherRole, item.club_id)

  return (
    <FeedCard testId="role-filled-card">
      <FeedCardHeader
        authorId={item.club_id}
        name={item.club_name}
        avatarUrl={item.club_avatar_url}
        role={publisherRole}
        createdAt={item.created_at}
        profilePath={publisherPath}
      />
      <FeedCardCaption icon={<CheckCircle2 />}>Role filled</FeedCardCaption>

      <FeedCardBody>
        <h3 className="text-[17px] font-semibold leading-6 text-gray-900">{item.title}</h3>
        {(item.position || item.filled_via_hockia) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.position && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium capitalize text-blue-700">
                {positionLabel(item.position)}
              </span>
            )}
            {item.filled_via_hockia && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f0fd] px-2.5 py-1 text-xs font-semibold text-hockia-primary">
                <BadgeCheck className="h-3 w-3" />
                Filled via HOCKIA
              </span>
            )}
          </div>
        )}
      </FeedCardBody>
    </FeedCard>
  )
}
