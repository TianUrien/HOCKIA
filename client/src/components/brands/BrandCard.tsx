/**
 * BrandCard Component
 *
 * Displays a brand in a card format for the directory grid.
 */

import { Link } from 'react-router-dom'
import { Store, ExternalLink, CheckCircle } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import type { Brand } from '@/hooks/useBrands'

interface BrandCardProps {
  brand: Brand
}

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  apparel: 'Apparel',
  accessories: 'Accessories',
  nutrition: 'Nutrition',
  technology: 'Technology',
  coaching: 'Coaching & Training',
  recruiting: 'Recruiting',
  media: 'Media',
  services: 'Services',
  other: 'Other',
}

export function BrandCard({ brand }: BrandCardProps) {
  return (
    <Link
      to={`/brands/${brand.slug}`}
      className="group block bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-indigo-200 transition-all duration-200"
    >
      {/* Logo Section */}
      <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6 relative">
        {brand.logo_url ? (
          <img
            src={getImageUrl(brand.logo_url, 'avatar-lg') ?? undefined}
            alt={brand.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Store className="w-16 h-16 text-gray-300 group-hover:text-gray-400 transition-colors" />
        )}

        {/* Verified Badge */}
        {brand.is_verified && (
          <div className="absolute top-3 right-3">
            <CheckCircle className="w-5 h-5 text-indigo-500" />
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
              {brand.name}
            </h3>
            <p className="text-sm text-gray-500 capitalize">
              {CATEGORY_LABELS[brand.category] || brand.category}
            </p>
          </div>
          {brand.website_url && (
            <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
          )}
        </div>

        {brand.bio && (
          <p className="mt-2 text-sm text-gray-600 line-clamp-2">
            {brand.bio}
          </p>
        )}

        {formatActivity(brand.last_activity_at) && (
          <p className="mt-2 text-xs text-gray-400">
            {formatActivity(brand.last_activity_at)}
          </p>
        )}
      </div>
    </Link>
  )
}

function formatActivity(dateString: string | undefined | null): string {
  if (!dateString) return ''
  const now = new Date()
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return ''
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 3600) return 'Active just now'
  if (seconds < 86400) return 'Active today'
  if (seconds < 172800) return 'Active yesterday'
  if (seconds < 604800) return `Active ${Math.floor(seconds / 86400)}d ago`

  return `Active ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export default BrandCard
