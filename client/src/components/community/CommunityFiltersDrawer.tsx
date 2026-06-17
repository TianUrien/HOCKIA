import { CATEGORY_LABELS, PLAYING_CATEGORIES } from '@/lib/hockeyCategories'
import { COACH_SPECIALIZATIONS } from '@/lib/coachSpecializations'
import CountryMultiSelect from '@/components/CountryMultiSelect'
import type { CommunityFiltersState } from './communityFilters'

/**
 * CommunityFiltersDrawer
 *
 * The drawer pane lifted out of PeopleListView so it can live above
 * the Top Community Members carousel alongside the search bar and the
 * Open-to-Opportunities + Filters quick-action row.
 *
 * Visibility is controlled by the lifted CommunityFiltersState
 * (`showFilters`) so toggling the Filters button in CommunityPage
 * opens this pane. On desktop the panel could be made sticky, but
 * the May 2026 layout favours mobile-first inline expansion.
 */

const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

const BRAND_CATEGORIES: { value: string; label: string }[] = [
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

interface CommunityFiltersDrawerProps {
  state: CommunityFiltersState
}

export function CommunityFiltersDrawer({ state }: CommunityFiltersDrawerProps) {
  const {
    filters,
    updateFilter,
    togglePosition,
    clearFilters,
    showFilters,
    setShowFilters,
    hasActiveFilters,
  } = state

  if (!showFilters) return null

  return (
    <aside className="mb-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Filters</h2>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-[#8026FA] hover:text-[#6B20D4] font-medium"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowFilters(false)}
            aria-label="Close filters"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Brand category — only on the Brands chip */}
      {filters.role === 'brand' && (
        <div>
          <label htmlFor="brand-category-filter" className="block text-sm font-medium text-gray-700 mb-2">
            Category
          </label>
          <select
            id="brand-category-filter"
            value={filters.brandCategory ?? ''}
            onChange={(e) => updateFilter('brandCategory', e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
          >
            <option value="">All categories</option>
            {BRAND_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Coaching role (coach only) — matches coach_specialization, not position */}
      {filters.role === 'coach' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Coaching Role</label>
          <div className="grid grid-cols-2 gap-2">
            {COACH_SPECIALIZATIONS.map((spec) => (
              <label key={spec.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.coachSpecializations.includes(spec.value)}
                  onChange={() => updateFilter(
                    'coachSpecializations',
                    filters.coachSpecializations.includes(spec.value)
                      ? filters.coachSpecializations.filter((s) => s !== spec.value)
                      : [...filters.coachSpecializations, spec.value],
                  )}
                  className="w-4 h-4 text-purple-600 rounded"
                />
                <span className="text-sm text-gray-700">{spec.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Position (player / all tab) */}
      {filters.role !== 'coach' && filters.role !== 'club' && filters.role !== 'brand' && filters.role !== 'umpire' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
          <div className="grid grid-cols-2 gap-2">
            {PLAYER_POSITIONS.map((position) => (
              <label key={position} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.position.includes(position)}
                  onChange={() => togglePosition(position)}
                  className="w-4 h-4 text-purple-600 rounded"
                />
                <span className="text-sm text-gray-700 capitalize">{position}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Hockey category — hidden for club + brand */}
      {filters.role !== 'club' && filters.role !== 'brand' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={filters.category === 'all'}
                onChange={() => updateFilter('category', 'all')}
                className="w-4 h-4 text-purple-600"
              />
              <span className="text-sm text-gray-700">All</span>
            </label>
            {PLAYING_CATEGORIES.map((cat) => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={filters.category === cat}
                  onChange={() => updateFilter('category', cat)}
                  className="w-4 h-4 text-purple-600"
                />
                <span className="text-sm text-gray-700">{CATEGORY_LABELS[cat]}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Location — country (structured, base_country_id) + a free-text city narrower */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
        <CountryMultiSelect
          value={filters.locationCountryIds}
          onChange={(ids) => updateFilter('locationCountryIds', ids)}
          placeholder="Add countries"
        />
        <input
          type="text"
          value={filters.location}
          onChange={(e) => updateFilter('location', e.target.value)}
          placeholder="City or region (optional)"
          className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />
      </div>

      {/* Nationality — dual-aware (matches either primary or secondary nationality) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Nationality</label>
        <CountryMultiSelect
          value={filters.nationalityCountryIds}
          onChange={(ids) => updateFilter('nationalityCountryIds', ids)}
          placeholder="Add nationalities"
        />
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={() => setShowFilters(false)}
          className="px-5 py-2 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold hover:opacity-90"
        >
          Done
        </button>
      </div>
    </aside>
  )
}
