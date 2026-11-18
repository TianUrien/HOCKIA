import { Link } from 'react-router-dom'
import { Store, BadgeCheck } from 'lucide-react'
import type { SearchBrandResult as SearchBrandResultType } from '@/hooks/useSearch'
import { useWorldT } from '@/i18n/ns/world'
import { useEnumsT } from '@/i18n/ns/enums'

/** Separator between facts; punctuation, not copy. */
const DOT = '·'

interface SearchBrandResultProps {
  result: SearchBrandResultType
}

/** Categories with a label in the shared enums catalog (enums:brandCategory.*). */
const CATEGORIES = ['equipment', 'apparel', 'accessories', 'nutrition', 'technology', 'coaching', 'recruiting', 'media', 'services', 'other'] as const
type Category = (typeof CATEGORIES)[number]
const isCategory = (value: string): value is Category => (CATEGORIES as readonly string[]).includes(value)

export function SearchBrandResult({ result }: SearchBrandResultProps) {
  const t = useWorldT()
  const tEnums = useEnumsT()
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
              <BadgeCheck className="w-4 h-4 text-positive flex-shrink-0" aria-label={t('searchResults.verifiedBrand')} />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {result.brand_category && (
              <span className="text-xs text-gray-500">
                {isCategory(result.brand_category) ? tEnums(`brandCategory.${result.brand_category}`) : result.brand_category}
              </span>
            )}
            {result.brand_bio && result.brand_category && (
              <span className="text-xs text-gray-500">{DOT}</span>
            )}
            {result.brand_bio && (
              <span className="text-xs text-gray-400 truncate">
                {result.brand_bio.length > 80 ? result.brand_bio.slice(0, 80) + '...' : result.brand_bio}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-medium text-[#be123c] bg-[#E11D48]/10 px-2 py-0.5 rounded-full flex-shrink-0">
          {tEnums('role.brand')}
        </span>
      </div>
    </Link>
  )
}
