/**
 * BrandPostCard
 *
 * Displays a brand post (announcement) in the feed.
 * Supports owner mode with edit/delete actions.
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Pencil, Trash2, CheckCircle, Store } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import type { BrandPost } from '@/hooks/useBrandPosts'
import { getTimeAgo } from '@/lib/utils'

interface BrandPostCardProps {
  post: BrandPost
  /** Brand info for feed display */
  brandName?: string
  brandSlug?: string
  brandLogoUrl?: string | null
  brandIsVerified?: boolean
  isOwner?: boolean
  onEdit?: (post: BrandPost) => void
  onDelete?: (post: BrandPost) => void
}

export function BrandPostCard({
  post,
  brandName,
  brandSlug,
  brandLogoUrl,
  brandIsVerified,
  isOwner = false,
  onEdit,
  onDelete,
}: BrandPostCardProps) {
  const [showMenu, setShowMenu] = useState(false)

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    const close = () => setShowMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showMenu])

  const timeAgo = getTimeAgo(post.created_at, true)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Brand header */}
      {brandName && brandSlug && (
        <div className="flex items-center gap-3 p-4 pb-0">
          <Link to={`/brands/${brandSlug}`} className="flex-shrink-0">
            {brandLogoUrl ? (
              <img
                src={getImageUrl(brandLogoUrl, 'avatar-sm') ?? undefined}
                alt={brandName}
                className="w-10 h-10 rounded-full object-cover border border-gray-200"
                decoding="async"
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
                to={`/brands/${brandSlug}`}
                className="font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors"
              >
                {brandName}
              </Link>
              {brandIsVerified && (
                <CheckCircle className="w-4 h-4 text-indigo-500 flex-shrink-0" />
              )}
            </div>
            <p className="text-xs text-gray-500">{timeAgo}</p>
          </div>

          {/* Owner menu */}
          {isOwner && (
            <div className="relative">
              <button
                type="button"
                aria-label="Post options"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px] z-10">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      onEdit?.(post)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      onDelete?.(post)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        <p className="text-gray-800 whitespace-pre-wrap">{post.content}</p>
      </div>

      {/* Image — reserved 4:3 box kills layout shift as the photo decodes */}
      {post.image_url && (
        <div className="px-4 pb-4">
          <div className="aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden">
            <img
              src={getImageUrl(post.image_url, 'feed-full') ?? undefined}
              alt="Post image"
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      )}
    </div>
  )
}

