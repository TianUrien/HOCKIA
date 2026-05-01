import { Link } from 'react-router-dom'
import { Avatar, RoleBadge } from '@/components'
import type { SearchPersonResult as SearchPersonResultType } from '@/hooks/useSearch'

interface SearchPersonResultProps {
  result: SearchPersonResultType
}

export function SearchPersonResult({ result }: SearchPersonResultProps) {
  const profilePath = result.role === 'club'
    ? `/clubs/id/${result.profile_id}?ref=search`
    : result.role === 'brand'
      ? `/brands/${result.profile_id}?ref=search`
      : result.role === 'umpire'
        ? `/umpires/id/${result.profile_id}?ref=search`
        : `/players/id/${result.profile_id}?ref=search`

  const subtitle = [result.position, result.base_location, result.current_club]
    .filter(Boolean)
    .join(' · ')

  // Truncate bio
  const bioPreview = result.bio && result.bio.length > 120
    ? result.bio.slice(0, 120) + '...'
    : result.bio

  return (
    <Link
      to={profilePath}
      className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
    >
      <Avatar
        src={result.avatar_url}
        initials={result.full_name?.slice(0, 2) || '?'}
        size="md"
        role={result.role}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 truncate text-sm">
            {result.full_name || 'Unknown'}
          </span>
          <RoleBadge role={result.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
        </div>
        {subtitle && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>
        )}
        {bioPreview && (
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{bioPreview}</p>
        )}
      </div>
    </Link>
  )
}
