/**
 * GlobalBrandFeed
 *
 * Unified feed showing products and posts from all brands.
 * Displays items in reverse-chronological order with infinite scroll.
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Rss, Store, ExternalLink, CheckCircle, ArrowRight } from 'lucide-react'
import { useBrandFeed, type FeedItem, type ProductFeedItem, type PostFeedItem } from '@/hooks/useBrandFeed'
import { FeedImageCarousel } from '@/components/home/FeedImageCarousel'
import Skeleton from '@/components/Skeleton'
import { getTimeAgo } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'

export function GlobalBrandFeed() {
  const { items, isLoading, error, hasMore, loadMore } = useBrandFeed()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoading) {
          void loadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isLoading, loadMore])

  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map(i => (
          <FeedSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
        {error}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <Rss className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No activity yet
        </h3>
        <p className="text-gray-500">
          When brands add products or share updates, they'll appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.map(item => (
        <FeedCard key={`${item.type}-${item.id}`} item={item} />
      ))}

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} />}

      {isLoading && items.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      )}
    </div>
  )
}

function FeedCard({ item }: { item: FeedItem }) {
  if (item.type === 'product') {
    return <ProductFeedCard item={item} />
  }
  return <PostFeedCard item={item} />
}

// --------------------------------------------------------------------------
// Product Feed Card
// --------------------------------------------------------------------------
function ProductFeedCard({ item }: { item: ProductFeedItem }) {
  const images = Array.isArray(item.product_images)
    ? [...item.product_images].sort((a, b) => a.order - b.order)
    : []
  const externalUrl = item.product_external_url || null
  const timeAgo = getTimeAgo(item.created_at, true)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Brand header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link to={`/brands/${item.brand_slug}`} className="flex-shrink-0">
          {item.brand_logo_url ? (
            <img
              src={getImageUrl(item.brand_logo_url, 'avatar-sm') ?? item.brand_logo_url}
              alt={item.brand_name}
              loading="lazy"
              decoding="async"
              className="w-10 h-10 rounded-full object-cover border border-gray-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <Store className="w-5 h-5 text-gray-400" />
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              to={`/brands/${item.brand_slug}`}
              className="font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors"
            >
              {item.brand_name}
            </Link>
            {item.brand_is_verified && (
              <CheckCircle className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-gray-500">Added a product &middot; {timeAgo}</p>
        </div>
      </div>

      {/* Product image carousel */}
      {images.length > 0 && (
        <FeedImageCarousel images={images} altPrefix={item.product_name} />
      )}

      {/* Product info */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-1">{item.product_name}</h3>
        {item.product_description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{item.product_description}</p>
        )}

        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            Learn more
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* View brand footer */}
      <div className="px-4 pb-3 pt-1 border-t border-gray-100">
        <Link
          to={`/brands/${item.brand_slug}`}
          className="text-sm text-gray-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1"
        >
          View brand
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Post Feed Card
// --------------------------------------------------------------------------
function PostFeedCard({ item }: { item: PostFeedItem }) {
  const timeAgo = getTimeAgo(item.created_at, true)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Brand header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link to={`/brands/${item.brand_slug}`} className="flex-shrink-0">
          {item.brand_logo_url ? (
            <img
              src={getImageUrl(item.brand_logo_url, 'avatar-sm') ?? item.brand_logo_url}
              alt={item.brand_name}
              loading="lazy"
              decoding="async"
              className="w-10 h-10 rounded-full object-cover border border-gray-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <Store className="w-5 h-5 text-gray-400" />
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              to={`/brands/${item.brand_slug}`}
              className="font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors"
            >
              {item.brand_name}
            </Link>
            {item.brand_is_verified && (
              <CheckCircle className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-gray-500">{timeAgo}</p>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <p className="text-gray-800 whitespace-pre-wrap">{item.post_content}</p>
      </div>

      {/* Image — right-sized (feed-full) + reserved 4:3 box (zero shift) */}
      {item.post_image_url && (
        <div className="px-4 pb-4">
          <div className="aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden">
            <img
              src={getImageUrl(item.post_image_url, 'feed-full') ?? undefined}
              alt="Post image"
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      )}

      {/* View brand footer */}
      <div className="px-4 pb-3 pt-1 border-t border-gray-100">
        <Link
          to={`/brands/${item.brand_slug}`}
          className="text-sm text-gray-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1"
        >
          View brand
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Skeleton loader
// --------------------------------------------------------------------------
function FeedSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton width="40%" height={16} />
          <Skeleton width="25%" height={12} />
        </div>
      </div>
      <div className="px-4 pb-4">
        <Skeleton variant="rectangular" className="aspect-[4/3] w-full" />
      </div>
      <div className="p-4 space-y-2">
        <Skeleton width="60%" height={18} />
        <Skeleton width="100%" height={14} />
      </div>
    </div>
  )
}

