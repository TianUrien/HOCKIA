import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Image, CheckCircle, Shield } from 'lucide-react'
import { Avatar, RoleBadge, StorageImage } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import type { MilestoneAchievedFeedItem, MilestoneType } from '@/types/homeFeed'

interface MilestoneCardProps {
  item: MilestoneAchievedFeedItem
}

const MILESTONE_CONFIG: Record<MilestoneType, {
  icon: typeof Image
  bgColor: string
  iconColor: string
  label: string
}> = {
  first_gallery_image: {
    icon: Image,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
    label: 'added gallery images',
  },
  profile_100_percent: {
    icon: CheckCircle,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
    label: 'completed their profile',
  },
  first_reference_received: {
    icon: Shield,
    bgColor: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    label: 'received their first reference',
  },
}

export function MilestoneCard({ item }: MilestoneCardProps) {
  const [mediaError, setMediaError] = useState(false)
  const timeAgo = getTimeAgo(item.created_at, true)
  const config = MILESTONE_CONFIG[item.milestone_type]

  // Unknown milestone type — don't render
  if (!config) return null

  // Media failed to load — hide entire card
  if (mediaError) return null

  const Icon = config.icon
  const profilePath = item.role === 'club'
    ? `/clubs/id/${item.profile_id}`
    : item.role === 'umpire'
      ? `/umpires/id/${item.profile_id}`
      : `/players/id/${item.profile_id}`

  return (
    <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-amber-400 overflow-hidden shadow-sm">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-8 h-8 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${config.iconColor}`} />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">Profile milestone</span>
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
            size="md"
            className="flex-shrink-0"
            role={item.role}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {item.full_name || 'Unknown'}
              </span>
              <RoleBadge role={item.role} />
            </div>
            <p className="text-sm text-gray-600">
              {config.label}
            </p>
          </div>
        </Link>

        {/* Milestone media preview */}
        {item.milestone_type === 'first_gallery_image' && item.image_url && (
          <StorageImage
            src={item.image_url}
            alt="Gallery"
            className="w-full h-auto max-h-80 object-cover rounded-lg"
            containerClassName="mt-4 rounded-lg overflow-hidden"
            fallbackClassName="mt-4 h-48 rounded-lg"
            onImageError={() => setMediaError(true)}
          />
        )}

        {/* CTA */}
        <div className="mt-4 flex justify-end">
          <Link
            to={profilePath}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
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
