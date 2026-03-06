import { useNavigate } from 'react-router-dom'
import { ChevronRight, Shield } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import AvailabilityPill from '@/components/AvailabilityPill'
import type { DiscoverResult } from '@/hooks/useDiscover'

interface DiscoverResultCardProps {
  result: DiscoverResult
}

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    if (result.role === 'brand') {
      navigate('/brands')
    } else if (result.role === 'club') {
      navigate(`/clubs/id/${result.id}?ref=discover`)
    } else {
      navigate(`/players/id/${result.id}?ref=discover`)
    }
  }

  const subtitle = [
    result.position,
    result.base_location || result.base_country_name,
  ]
    .filter(Boolean)
    .join(' · ')

  const availabilityPill = result.open_to_play
    ? <AvailabilityPill variant="play" size="sm" />
    : result.open_to_coach
      ? <AvailabilityPill variant="coach" size="sm" />
      : null

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
    >
      <Avatar
        src={result.avatar_url}
        alt={result.full_name ?? undefined}
        initials={result.full_name?.charAt(0)}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 truncate">
            {result.full_name ?? 'Unknown'}
          </span>
          <RoleBadge role={result.role} className="flex-shrink-0" />
          {result.accepted_reference_count > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium flex-shrink-0">
              <Shield className="w-2.5 h-2.5" />
              {result.accepted_reference_count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {subtitle && (
            <p className="text-xs text-gray-500 truncate">{subtitle}</p>
          )}
          {availabilityPill && (
            <span className="flex-shrink-0">{availabilityPill}</span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
    </button>
  )
}
