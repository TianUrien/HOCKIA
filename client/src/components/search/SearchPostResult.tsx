import { Link } from 'react-router-dom'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { SearchPostResult as SearchPostResultType } from '@/hooks/useSearch'

interface SearchPostResultProps {
  result: SearchPostResultType
}

export function SearchPostResult({ result }: SearchPostResultProps) {
  const timeAgo = getTimeAgo(result.created_at, true)

  const profilePath = result.author_role === 'club'
    ? `/clubs/id/${result.author_id}`
    : result.author_role === 'brand'
      ? `/brands/${result.author_id}`
      : result.author_role === 'umpire'
        ? `/umpires/id/${result.author_id}`
        : `/players/id/${result.author_id}`

  // Truncate content for preview
  const preview = result.content.length > 200
    ? result.content.slice(0, 200) + '...'
    : result.content

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <Link to={profilePath} className="flex-shrink-0">
          <Avatar
            src={result.author_avatar}
            initials={result.author_name?.slice(0, 2) || '?'}
            size="sm"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              to={profilePath}
              className="font-semibold text-gray-900 truncate text-sm hover:text-[#8026FA] transition-colors"
            >
              {result.author_name || 'Unknown'}
            </Link>
            <RoleBadge role={result.author_role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
          </div>
          <p className="text-xs text-gray-500">{timeAgo}</p>
        </div>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{preview}</p>

      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
        {result.like_count > 0 && (
          <span>{result.like_count} like{result.like_count !== 1 ? 's' : ''}</span>
        )}
        {result.comment_count > 0 && (
          <span>{result.comment_count} comment{result.comment_count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}
