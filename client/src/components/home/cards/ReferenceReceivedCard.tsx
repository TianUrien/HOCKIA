import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowDown } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { ReferenceReceivedFeedItem } from '@/types/homeFeed'

interface ReferenceReceivedCardProps {
  item: ReferenceReceivedFeedItem
}

function getProfilePath(role: string, id: string) {
  if (role === 'club') return `/clubs/id/${id}?ref=feed`
  if (role === 'umpire') return `/umpires/id/${id}?ref=feed`
  return `/players/id/${id}?ref=feed`
}

export function ReferenceReceivedCard({ item }: ReferenceReceivedCardProps) {
  const timeAgo = getTimeAgo(item.created_at, true)
  const receiverPath = getProfilePath(item.role, item.profile_id)
  const refereePath = item.referee_role
    ? getProfilePath(item.referee_role, item.referee_id)
    : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">New reference</span>
            <span>&middot;</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Referee — person who gave the reference */}
        {refereePath ? (
          <Link to={refereePath} className="flex items-center gap-3 group">
            <Avatar
              src={item.referee_avatar}
              initials={item.referee_name?.slice(0, 2) || '?'}
              size="md"
              className="flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 group-hover:text-[#8026FA] transition-colors truncate">
                  {item.referee_name || 'Unknown'}
                </span>
                {item.referee_role && <RoleBadge role={item.referee_role} />}
              </div>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar
              src={item.referee_avatar}
              initials={item.referee_name?.slice(0, 2) || '?'}
              size="md"
              className="flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 truncate">
                  {item.referee_name || 'Unknown'}
                </span>
                {item.referee_role && <RoleBadge role={item.referee_role} />}
              </div>
            </div>
          </div>
        )}

        {/* Connector */}
        <div className="flex items-center gap-2 my-2.5 ml-[18px]">
          <ArrowDown className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">vouched for</span>
        </div>

        {/* Receiver — person who received the reference */}
        <Link
          to={receiverPath}
          className="flex items-center gap-3 group"
        >
          <Avatar
            src={item.avatar_url}
            initials={item.full_name?.slice(0, 2) || '?'}
            size="md"
            className="flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 group-hover:text-[#8026FA] transition-colors truncate">
                {item.full_name || 'Unknown'}
              </span>
              <RoleBadge role={item.role} />
            </div>
          </div>
        </Link>

        {/* Endorsement Quote */}
        {item.endorsement_text && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 border-l-4 border-l-[#8026FA]/25">
            <p className="text-sm text-gray-600 italic line-clamp-2">
              &ldquo;{item.endorsement_text}&rdquo;
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-4 flex justify-end">
          <Link
            to={receiverPath}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Read full reference
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}
