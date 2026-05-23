import { Link } from 'react-router-dom'
import { Store, BadgeCheck, ExternalLink } from 'lucide-react'
import { getTimeAgo } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'
import { FeedImageCarousel } from '../FeedImageCarousel'
import type { BrandProductFeedItem } from '@/types/homeFeed'

interface BrandProductCardProps {
  item: BrandProductFeedItem
}

export function BrandProductCard({ item }: BrandProductCardProps) {
  const timeAgo = getTimeAgo(item.created_at, true)
  const sortedImages = item.product_images
    ? [...item.product_images].sort((a, b) => a.order - b.order)
    : []

  return (
    <div className="bg-white">
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
            </div>
            <p className="text-xs text-gray-400">{timeAgo}</p>
          </div>
        </Link>
      </div>

      {/* Product Image Carousel */}
      {sortedImages.length > 0 && (
        <FeedImageCarousel images={sortedImages} altPrefix={item.product_name} />
      )}

      {/* Product Info */}
      <div className="p-5 pt-3">
        <h3 className="font-bold text-gray-900 mb-1">{item.product_name}</h3>
        {item.product_description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-4">
            {item.product_description}
          </p>
        )}

        {/* CTA */}
        {item.product_external_url && (
          <a
            href={item.product_external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-4 py-2.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            Learn more
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  )
}
