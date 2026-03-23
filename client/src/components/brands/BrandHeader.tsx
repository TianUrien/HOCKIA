/**
 * BrandHeader Component
 *
 * Cover image, logo, and name section for brand profiles.
 */

import { Store, CheckCircle, Globe, Instagram } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import type { BrandDetail } from '@/hooks/useBrand'

interface BrandHeaderProps {
  brand: BrandDetail
}

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  apparel: 'Apparel',
  accessories: 'Accessories',
  nutrition: 'Nutrition',
  services: 'Services',
  technology: 'Technology',
  other: 'Other',
}

export function BrandHeader({ brand }: BrandHeaderProps) {
  return (
    <div className="relative">
      {/* Cover */}
      <div className="h-32 sm:h-48 bg-gradient-to-br from-indigo-500 to-purple-600" />

      {/* Logo and Info */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="relative -mt-12 sm:-mt-16 flex flex-col sm:flex-row sm:items-end sm:gap-6">
          {/* Logo */}
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-white rounded-xl shadow-lg border-4 border-white flex items-center justify-center overflow-hidden flex-shrink-0">
            {brand.logo_url ? (
              <img
                src={getImageUrl(brand.logo_url, 'avatar-lg') ?? undefined}
                alt={brand.name}
                className="w-full h-full object-contain p-2"
                decoding="async"
              />
            ) : (
              <Store className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300" />
            )}
          </div>

          {/* Name and Category */}
          <div className="mt-4 sm:mt-0 sm:pb-2 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">
                {brand.name}
              </h1>
              {brand.is_verified && (
                <CheckCircle className="w-6 h-6 text-indigo-500 flex-shrink-0" />
              )}
            </div>
            <p className="text-gray-500 mt-1">
              {CATEGORY_LABELS[brand.category] || brand.category}
            </p>

            {/* Links */}
            <div className="flex items-center gap-4 mt-3">
              {brand.website_url && (
                <a
                  href={brand.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  <Globe className="w-4 h-4" />
                  <span>Website</span>
                </a>
              )}
              {brand.instagram_url && (
                <a
                  href={brand.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  <Instagram className="w-4 h-4" />
                  <span>Instagram</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrandHeader
