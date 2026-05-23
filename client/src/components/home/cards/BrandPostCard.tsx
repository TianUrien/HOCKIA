import { Link } from 'react-router-dom'
import { Store, BadgeCheck } from 'lucide-react'
import { getTimeAgo } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'
import type { BrandPostFeedItem } from '@/types/homeFeed'

interface BrandPostCardProps {
  item: BrandPostFeedItem
}

export function BrandPostCard({ item }: BrandPostCardProps) {
  const timeAgo = getTimeAgo(item.created_at, true)

  return (
    <div className="bg-white border-t-4 border-t-rose-500">
      <div className="p-5 pb-0">
        {/* Brand Header */}
        <Link
          to={`/brands/${item.brand_slug}`}
          className="flex items-center gap-3 mb-4 group"
        >
          {item.brand_logo_url ? (
            <img
              src={getImageUrl(item.brand_logo_url, 'avatar-sm') ?? undefined}
              alt={item.brand_name || ''}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              decoding="async"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Store className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                {item.brand_name}
              </span>
              {item.brand_is_verified && (
                <BadgeCheck className="w-4 h-4 text-blue-500 flex-shrink-0" />
              )}
              {item.brand_category && (
                <span className="text-xs text-gray-400 flex-shrink-0">&middot; {item.brand_category}</span>
              )}
            </div>
            <p className="text-xs text-gray-400">{timeAgo}</p>
          </div>
        </Link>

        {/* Post Content */}
        {item.post_content && (
          <p className="text-gray-800 mb-4 whitespace-pre-line break-words">
            {item.post_content}
          </p>
        )}
      </div>

      {/* Post Image — full-width / flush to card edges (Facebook style) */}
      {item.post_image_url && (
        <img
          src={getImageUrl(item.post_image_url, 'feed-full') ?? undefined}
          alt=""
          className="w-full h-auto max-h-96 object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  )
}
