import { Link } from 'react-router-dom'
import { Store, BadgeCheck } from 'lucide-react'
import type { SearchBrandResult as SearchBrandResultType } from '@/hooks/useSearch'

interface SearchBrandResultProps {
  result: SearchBrandResultType
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

export function SearchBrandResult({ result }: SearchBrandResultProps) {
  return (
    <Link
      to={`/brands/${result.brand_slug}`}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
          {result.brand_logo_url ? (
            <img src={result.brand_logo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Store className="w-6 h-6 text-gray-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-gray-900 truncate">{result.brand_name}</span>
            {result.brand_is_verified && (
              <BadgeCheck className="w-4 h-4 text-blue-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {result.brand_category && (
              <span className="text-xs text-gray-500">
                {CATEGORY_LABELS[result.brand_category] || result.brand_category}
              </span>
            )}
            {result.brand_bio && result.brand_category && (
              <span className="text-xs text-gray-300">&middot;</span>
            )}
            {result.brand_bio && (
              <span className="text-xs text-gray-400 truncate">
                {result.brand_bio.length > 80 ? result.brand_bio.slice(0, 80) + '...' : result.brand_bio}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-medium text-[#E11D48] bg-[#E11D48]/10 px-2 py-0.5 rounded-full flex-shrink-0">
          Brand
        </span>
      </div>
    </Link>
  )
}
