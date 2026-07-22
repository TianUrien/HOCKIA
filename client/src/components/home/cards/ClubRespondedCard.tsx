import { Link } from 'react-router-dom'
import { Zap, ArrowUpRight } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { ClubRespondedFeedItem } from '@/types/homeFeed'

interface Props {
  item: ClubRespondedFeedItem
}

/**
 * club_responded — "Active recruiter". An aggregate: one card per (club, week)
 * showing how many applications the club reviewed this week. Signals to
 * players that the club is actively triaging → apply now.
 */
export function ClubRespondedCard({ item }: Props) {
  const timeAgo = getTimeAgo(item.created_at, true)
  // Vacancies can be coach-published — then club_id/club_name carry the
  // COACH's profile, and the club route 404s ("Club profile not found").
  // author_role comes from the RPC merge; 'club' fallback = cached payloads.
  const publisherRole = item.author_role === 'coach' ? 'coach' : 'club'
  const clubPath =
    publisherRole === 'coach'
      ? `/coaches/id/${item.club_id}?ref=feed`
      : `/clubs/id/${item.club_id}?ref=feed`
  const n = item.response_count ?? 0

  return (
    <div className="bg-white">
      <div className="p-5">
        <Link to={clubPath} className="flex items-center gap-3 group">
          <Avatar
            src={item.club_avatar_url}
            initials={item.club_name?.slice(0, 2) || '?'}
            size="lg"
            role={publisherRole}
            className="flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                {item.club_name || 'A club'}
              </h3>
              <RoleBadge role={publisherRole} />
            </div>
            <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <span>
                Reviewed <span className="font-semibold text-emerald-700">{n}</span>{' '}
                {n === 1 ? 'application' : 'applications'} this week
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{timeAgo}</p>
          </div>
        </Link>

        <div className="mt-4 flex justify-end">
          <Link
            to={clubPath}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {publisherRole === 'coach' ? 'View Coach' : 'View Club'}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
