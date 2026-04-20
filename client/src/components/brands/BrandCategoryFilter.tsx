/**
 * BrandCategoryFilter Component
 *
 * Filter pills for selecting brand categories in the directory.
 */

import type { BrandCategory } from '@/hooks/useBrands'

interface CategoryOption {
  value: BrandCategory | null
  label: string
}

const CATEGORIES: CategoryOption[] = [
  { value: null, label: 'All' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'technology', label: 'Technology' },
  { value: 'coaching', label: 'Coaching & Training' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'media', label: 'Media' },
  { value: 'services', label: 'Services' },
  { value: 'other', label: 'Other' },
]

interface BrandCategoryFilterProps {
  value: BrandCategory | null
  onChange: (category: BrandCategory | null) => void
}

export function BrandCategoryFilter({ value, onChange }: BrandCategoryFilterProps) {
  return (
    <div
      data-testid="brand-category-filter"
      className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
    >
      {CATEGORIES.map((category) => {
        const isActive = value === category.value
        return (
          <button
            key={category.value ?? 'all'}
            type="button"
            onClick={() => onChange(category.value)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all
              ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            {category.label}
          </button>
        )
      })}
    </div>
  )
}

export default BrandCategoryFilter
