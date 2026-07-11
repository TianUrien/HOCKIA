/**
 * ProductCard
 *
 * Visual card for displaying a brand product.
 * Includes image carousel with CSS scroll-snap, product info, and CTA button.
 * Supports both owner mode (edit/delete) and public view mode.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import { useImpressionOnce, recordProductView } from '@/lib/homeInstrumentation'
import type { BrandProduct } from '@/hooks/useBrandProducts'

interface ProductCardProps {
  product: BrandProduct
  brandWebsiteUrl?: string | null
  isOwner?: boolean
  onEdit?: (product: BrandProduct) => void
  onDelete?: (product: BrandProduct) => void
}

export function ProductCard({
  product,
  brandWebsiteUrl,
  isOwner = false,
  onEdit,
  onDelete,
}: ProductCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [showMenu, setShowMenu] = useState(false)

  // product_view (Home redesign §4): once per product per session, viewport-
  // gated. Feeds the Brand reach module — owners viewing their own products
  // are not "reach", so skip them.
  const impressionRef = useImpressionOnce(() => {
    if (!isOwner) recordProductView(product.id, product.brand_id)
  })

  const images = product.images?.length
    ? [...product.images].sort((a, b) => a.order - b.order)
    : []

  const externalUrl = product.external_url || brandWebsiteUrl || null

  // Track scroll position for dot indicators
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || images.length <= 1) return
    const index = Math.round(el.scrollLeft / el.offsetWidth)
    setCurrentSlide(index)
  }, [images.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    const close = () => setShowMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showMenu])

  return (
    <div
      ref={impressionRef}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Image carousel */}
      {images.length > 0 && (
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none]"
          >
            {images.map((img, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-full snap-start"
              >
                <div className="aspect-[4/3] bg-gray-100">
                  <img
                    src={getImageUrl(img.url, 'feed-full') ?? undefined}
                    alt={`${product.name} - image ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Dot indicators (below image) */}
          {images.length > 1 && (
            <div className="flex justify-center gap-1.5 py-2 bg-white">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to image ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === currentSlide ? 'bg-indigo-500' : 'bg-gray-300'
                  }`}
                  onClick={() => {
                    scrollRef.current?.scrollTo({
                      left: i * (scrollRef.current?.offsetWidth ?? 0),
                      behavior: 'smooth',
                    })
                  }}
                />
              ))}
            </div>
          )}

          {/* Owner action menu */}
          {isOwner && (
            <div className="absolute top-2 right-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className="p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
                aria-label="Product actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px] z-10">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      onEdit?.(product)
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
                      onDelete?.(product)
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

      {/* Product info */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-1">{product.name}</h3>
        {product.description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{product.description}</p>
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
    </div>
  )
}
