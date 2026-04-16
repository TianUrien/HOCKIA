import { Link } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { Avatar, RoleBadge, NationalityCardDisplay } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { MemberJoinedFeedItem } from '@/types/homeFeed'

interface MemberJoinedCardProps {
  item: MemberJoinedFeedItem
}

export function MemberJoinedCard({ item }: MemberJoinedCardProps) {
  const timeAgo = getTimeAgo(item.created_at, true)
  const profilePath = item.role === 'club'
    ? `/clubs/id/${item.profile_id}?ref=feed`
    : `/players/id/${item.profile_id}?ref=feed`

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <UserPlus className="w-4 h-4 text-green-600" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">New member joined HOCKIA</span>
            <span>&middot;</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Member Info */}
        <Link
          to={profilePath}
          className="flex items-start gap-4 group"
        >
          <Avatar
            src={item.avatar_url}
            initials={item.full_name?.slice(0, 2) || '?'}
            size="lg"
            className="flex-shrink-0"
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {item.full_name || 'Unknown'}
              </h3>
              <RoleBadge role={item.role} />
            </div>

            {item.nationality_country_id && (
              <div className="mb-1">
                <NationalityCardDisplay
                  primaryCountryId={item.nationality_country_id}
                />
              </div>
            )}

            {item.current_club && (
              <p className="text-sm text-gray-500">{item.current_club}</p>
            )}

            {item.position && (
              <p className="text-sm text-gray-500 mt-1">{item.position}</p>
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
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}
