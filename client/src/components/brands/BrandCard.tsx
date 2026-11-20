/**
 * BrandCard Component
 *
 * Displays a brand in a card format for the directory grid.
 */

import { OrgLogo } from '@/components/ui/OrgLogo'
import { Link } from 'react-router-dom'
import { Store, ExternalLink, CheckCircle } from 'lucide-react'
import { dayFirst } from '@/lib/dayFirst'
import type { Brand } from '@/hooks/useBrands'
import { useEnumsT } from '@/i18n/ns/enums'
import { tBrands } from '@/i18n/ns/brands'

interface BrandCardProps {
  brand: Brand
}

const CATEGORIES = new Set(['equipment', 'apparel', 'accessories', 'nutrition', 'technology', 'coaching', 'recruiting', 'media', 'services', 'other'])

export function BrandCard({ brand }: BrandCardProps) {
  const tEnum = useEnumsT()
  return (
    <Link
      to={`/brands/${brand.slug}`}
      className="group block bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-indigo-200 transition-all duration-200"
    >
      {/* Logo Section */}
      <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6 relative">
        {brand.logo_url ? (
          <OrgLogo src={brand.logo_url} alt={brand.name} role="brand" imageSize="avatar-lg" className="h-full w-full transition-transform duration-200 group-hover:scale-105" />
        ) : (
          <Store className="w-16 h-16 text-gray-500 group-hover:text-gray-400 transition-colors" />
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
              {CATEGORIES.has(brand.category) ? tEnum(`brandCategory.${brand.category}`) : brand.category}
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

  if (seconds < 3600) return tBrands('brandCard.activeNow')
  if (seconds < 86400) return tBrands('brandCard.activeToday')
  if (seconds < 172800) return tBrands('brandCard.activeYesterday')
  if (seconds < 604800) return tBrands('brandCard.activeDaysAgo', { count: Math.floor(seconds / 86400) })

  // "Active 3 Oct" — day first (lib/dayFirst).
  return tBrands('brandCard.activeOn', { date: dayFirst(date) })
}

export default BrandCard
