/**
 * BrandCategoryFilter Component
 *
 * Filter pills for selecting brand categories in the directory.
 */

import type { BrandCategory } from '@/hooks/useBrands'
import { useEnumsT } from '@/i18n/ns/enums'
import { useBrandsT } from '@/i18n/ns/brands'

const CATEGORIES: (BrandCategory | null)[] = [null, 'equipment', 'apparel', 'accessories', 'nutrition', 'technology', 'coaching', 'recruiting', 'media', 'services', 'other']

interface BrandCategoryFilterProps {
  value: BrandCategory | null
  onChange: (category: BrandCategory | null) => void
}

export function BrandCategoryFilter({ value, onChange }: BrandCategoryFilterProps) {
  const t = useBrandsT()
  const tEnum = useEnumsT()
  return (
    <div
      data-testid="brand-category-filter"
      className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
    >
      {CATEGORIES.map((category) => {
        const isActive = value === category
        return (
          <button
            key={category ?? 'all'}
            type="button"
            onClick={() => onChange(category)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all
              ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            {category ? tEnum(`brandCategory.${category}`) : t('categoryFilter.all')}
          </button>
        )
      })}
    </div>
  )
}

export default BrandCategoryFilter
