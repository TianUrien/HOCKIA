import { Link } from 'react-router-dom'
import { BadgeCheck, ArrowUpRight } from 'lucide-react'
import { Avatar, RoleBadge, NationalityCardDisplay } from '@/components'
import { getTimeAgo } from '@/lib/utils'
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
  const timeAgo = getTimeAgo(item.created_at, true)
  const profilePath = `/players/id/${item.player_id}?ref=feed`

  return (
    <div className="bg-white">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#8026FA]/10 flex items-center justify-center flex-shrink-0">
            <BadgeCheck className="w-4 h-4 text-[#8026FA]" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">Open to play</span>
            <span>&middot;</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Player */}
        <Link to={profilePath} className="flex items-start gap-4 group">
          <Avatar
            src={item.player_avatar_url}
            initials={item.player_name?.slice(0, 2) || '?'}
            size="lg"
            role={item.player_role}
            className="flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {item.player_name || 'A player'}
              </h3>
              <RoleBadge role={item.player_role} />
            </div>

            {item.country_id && (
              <div className="mb-1">
                <NationalityCardDisplay primaryCountryId={item.country_id} />
              </div>
            )}

            {item.position && (
              <p className="text-sm text-gray-500">{item.position}</p>
            )}

            {item.open_to_opportunities && (
              <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full bg-[#8026FA]/10 text-[#8026FA] text-xs font-medium">
                Open to opportunities
              </span>
            )}
          </div>
        </Link>

        {/* CTA */}
        <div className="mt-4 flex justify-end">
          <Link
            to={profilePath}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            View Profile
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
