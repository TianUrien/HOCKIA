import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, TrendingUp, TrendingDown, Users, EyeOff, ChevronDown } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { useProfileViewers } from '@/hooks/useProfileViewers'
import { getTimeAgo } from '@/lib/utils'

const COLLAPSED_COUNT = 3

export function ProfileViewersSection() {
  const navigate = useNavigate()
  const { viewers, stats, isLoading } = useProfileViewers()
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
        <div className="flex gap-4 mb-6">
          <div className="h-16 flex-1 bg-gray-100 rounded-xl" />
          <div className="h-16 flex-1 bg-gray-100 rounded-xl" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-full" />
              <div className="flex-1">
                <div className="h-4 w-32 bg-gray-200 rounded mb-1" />
                <div className="h-3 w-24 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const trendPct = stats && stats.previous_total_views > 0
    ? Math.round(((stats.total_views - stats.previous_total_views) / stats.previous_total_views) * 100)
    : null
  const trendUp = trendPct !== null && trendPct >= 0

  const handleViewerClick = (viewer: typeof viewers[0]) => {
    if (viewer.role === 'club') {
      navigate(`/clubs/id/${viewer.viewer_id}`)
    } else if (viewer.role === 'brand') {
      if (viewer.brand_slug) {
        navigate(`/brands/${viewer.brand_slug}`)
      }
    } else if (viewer.role === 'umpire') {
      navigate(`/umpires/id/${viewer.viewer_id}`)
    } else {
      navigate(`/players/id/${viewer.viewer_id}`)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-5 h-5 text-[#8026FA]" />
        <h3 className="text-base font-semibold text-gray-900">Who Viewed Your Profile</h3>
      </div>

      {/* Stats row */}
      {stats && (stats.total_views > 0 || stats.anonymous_viewers > 0) && (
        <div className="flex gap-3 mb-5">
          <div className="flex-1 bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-0.5">Total Views</p>
            <div className="flex items-baseline gap-1.5">
              <p className="text-xl font-bold text-gray-900">{stats.total_views}</p>
              {trendPct !== null && (
                <span className={`text-xs font-medium flex items-center gap-0.5 ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>
                  {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {trendUp ? '+' : ''}{trendPct}%
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-0.5">Unique Viewers</p>
            <p className="text-xl font-bold text-gray-900">{stats.unique_viewers}</p>
          </div>
        </div>
      )}

      {/* Viewer list */}
      {viewers.length > 0 ? (
        <div className="space-y-1">
          {(expanded ? viewers : viewers.slice(0, COLLAPSED_COUNT)).map((viewer) => {
            const displayName = viewer.full_name ?? (viewer.role === 'brand' ? 'Brand' : '')
            const initials = viewer.full_name
              ? viewer.full_name.split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2)
              : '?'
            return (
            <button
              key={viewer.viewer_id}
              type="button"
              onClick={() => handleViewerClick(viewer)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
            >
              <Avatar
                src={viewer.avatar_url}
                alt={displayName}
                initials={initials}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-sm truncate">{displayName}</span>
                  <RoleBadge role={viewer.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {[
                    viewer.base_location,
                    viewer.view_count > 1 ? `${viewer.view_count} views` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                {getTimeAgo(viewer.viewed_at, true)}
              </span>
            </button>
            )
          })}
          {viewers.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-[#8026FA] hover:bg-purple-50 rounded-xl transition-colors"
            >
              {expanded ? 'Show less' : `See all ${viewers.length} viewers`}
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      ) : (
        <div className="text-center py-6">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No profile views yet</p>
          <p className="text-xs text-gray-400 mt-1">Share your profile to get discovered</p>
        </div>
      )}

      {/* Anonymous viewers note */}
      {stats && stats.anonymous_viewers > 0 && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <EyeOff className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs text-gray-400">
            +{stats.anonymous_viewers} anonymous {stats.anonymous_viewers === 1 ? 'viewer' : 'viewers'}
          </p>
        </div>
      )}
    </div>
  )
}
