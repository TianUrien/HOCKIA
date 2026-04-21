/**
 * SharedPostCard
 *
 * Compact card rendered inside a MessageBubble when a message carries
 * shared-post metadata.  Displays the post author, content preview,
 * optional thumbnail, and a "View post" link.
 */

import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import { cn } from '@/lib/utils'

interface SharedPostCardProps {
  postId: string
  authorName: string | null
  authorAvatar: string | null
  authorRole: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  contentPreview: string
  thumbnailUrl: string | null
  isMine: boolean
}

export function SharedPostCard({
  postId,
  authorName,
  authorAvatar,
  authorRole,
  contentPreview,
  thumbnailUrl,
  isMine,
}: SharedPostCardProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/post/${postId}`)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full rounded-xl p-3 text-left transition-colors',
        isMine
          ? 'bg-white/10 hover:bg-white/15'
          : 'border border-gray-200 bg-gray-50 hover:bg-gray-100',
      )}
    >
      {/* Author row */}
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar
          src={authorAvatar}
          initials={authorName?.slice(0, 2) || '?'}
          size="sm"
        />
        <span
          className={cn(
            'text-xs font-semibold truncate',
            isMine ? 'text-white' : 'text-gray-900',
          )}
        >
          {authorName || 'Unknown'}
        </span>
        <RoleBadge role={authorRole} />
      </div>

      {/* Content preview */}
      <p
        className={cn(
          'text-[13px] leading-snug line-clamp-3',
          isMine ? 'text-white/90' : 'text-gray-700',
        )}
      >
        {contentPreview}
      </p>

      {/* Optional thumbnail */}
      {thumbnailUrl && (
        <div className="mt-2 overflow-hidden rounded-lg">
          <img
            src={getImageUrl(thumbnailUrl, 'feed-thumb') ?? undefined}
            alt=""
            className="w-full h-28 object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      {/* View post link */}
      <div
        className={cn(
          'mt-2 flex items-center gap-1 text-xs font-medium',
          isMine ? 'text-white/70' : 'text-[#8026FA]',
        )}
      >
        <span>View post</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    </button>
  )
}
