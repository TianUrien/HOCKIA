import { Link } from 'react-router-dom'
import { CheckCircle2, BadgeCheck } from 'lucide-react'
import { Avatar } from '@/components'
import { getTimeAgo } from '@/lib/utils'
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
  const timeAgo = getTimeAgo(item.created_at, true)

  return (
    <div className="bg-white">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">Role filled</span>
            <span>&middot;</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Filled role */}
        <div className="mb-1">
          <h3 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h3>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {item.position && (
              <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium capitalize">
                {item.position.replace(/_/g, ' ')}
              </span>
            )}
            {item.filled_via_hockia && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#f4f0fd] text-hockia-primary rounded-full text-xs font-semibold">
                <BadgeCheck className="w-3 h-3" />
                Filled via HOCKIA
              </span>
            )}
          </div>

          <Link to={`/clubs/id/${item.club_id}`} className="flex items-center gap-2.5 group">
            <span className="text-sm text-gray-500">by</span>
            <Avatar
              src={item.club_avatar_url}
              initials={item.club_name?.slice(0, 2) || '?'}
              size="sm"
              className="flex-shrink-0"
              role="club"
            />
            <span className="text-sm font-medium text-gray-700 group-hover:text-hockia-primary transition-colors">
              {item.club_name}
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}
