import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { CATEGORY_LABELS, PLAYING_CATEGORIES } from '@/lib/hockeyCategories'
import { COACH_SPECIALIZATIONS } from '@/lib/coachSpecializations'
import CountryMultiSelect from '@/components/CountryMultiSelect'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { MEMBER_TYPES } from './communityFilters'
import type { CommunityFiltersState, RoleFilter } from './communityFilters'

/**
 * CommunityFiltersDrawer — a portal-rendered mobile BOTTOM SHEET (Phase 3 pt2).
 *
 * Which fields render is driven by COMMUNITY_FILTER_CONFIG (per role) so the UI
 * never offers a filter the data can't back. Sticky header (Clear all) + sticky
 * footer ("Show N results"), height-capped scroll body, iOS safe-area, 44pt
 * targets. Mirrors the MemberPreviewModal sheet pattern the community already uses.
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

type FilterField =
  | 'brandCategory' | 'coachRole' | 'position' | 'category'
  | 'officiating' | 'location' | 'nationality' | 'eu' | 'hasVideo' | 'evidence' | 'openOpportunities'

/** Single source of role-awareness: which filter fields show per role tab.
 *  Grounded in real data — clubs/brands have no nationality/EU; only players/all
 *  have position; coaches get coach role; umpires get officiating type. */
const COMMUNITY_FILTER_CONFIG: Record<RoleFilter, FilterField[]> = {
  all:    ['position', 'category', 'location', 'nationality', 'eu'],
  player: ['position', 'category', 'location', 'nationality', 'eu', 'hasVideo', 'evidence'],
  coach:  ['coachRole', 'category', 'location', 'nationality', 'eu', 'evidence'],
  umpire: ['officiating', 'category', 'location', 'nationality', 'eu'],
  club:   ['location', 'openOpportunities'],
  brand:  ['brandCategory', 'location'],
}

interface CommunityFiltersDrawerProps {
  state: CommunityFiltersState
  /** Live count of members matching the current filters — shown in the footer CTA. */
  resultCount?: number | null
  /** Players-with-video count for the count-labelled "Has video (N)" toggle. */
  videoCount?: number | null
  /** Set the member type (role). Navigates the same /community/<role> URL the
   *  external role chips use, so both affordances write the one source of truth. */
  onSelectRole: (role: RoleFilter) => void
}

export function CommunityFiltersDrawer({ state, resultCount, videoCount, onSelectRole }: CommunityFiltersDrawerProps) {
  const {
    filters,
    updateFilter,
    togglePosition,
    clearFilters,
    showFilters,
    setShowFilters,
    hasActiveFilters,
  } = state

  useBodyScrollLock(showFilters)

  useEffect(() => {
    if (!showFilters) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilters(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showFilters, setShowFilters])

  if (!showFilters) return null

  const fields = COMMUNITY_FILTER_CONFIG[filters.role] ?? COMMUNITY_FILTER_CONFIG.all
  const ctaLabel = typeof resultCount === 'number'
    ? `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? 'result' : 'results'}`
    : 'Done'

  const sheet = (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={() => setShowFilters(false)}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          className="pointer-events-auto w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[85vh] flex flex-col animate-slide-in-up"
        >
          {/* Sticky header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">Filters</h2>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm text-[#8026FA] hover:text-[#6B20D4] font-medium min-h-[44px] px-2"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                aria-label="Close filters"
                className="text-gray-400 hover:text-gray-600 p-2 -mr-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Member type — sets the role. Same state + URL the external role
                chips drive, so the two affordances never diverge. Rendered first
                and unconditionally (the one field that SETS role, not gated on it). */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Member type</label>
              <div className="flex flex-wrap gap-2">
                {MEMBER_TYPES.map((mt) => {
                  const active = filters.role === mt.role
                  return (
                    <button
                      key={mt.role}
                      type="button"
                      onClick={() => onSelectRole(mt.role)}
                      aria-pressed={active ? 'true' : 'false'}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        active
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {mt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Brand category */}
            {fields.includes('brandCategory') && (
              <div>
                <label htmlFor="brand-category-filter" className="block text-sm font-medium text-gray-700 mb-2">Category</label>
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

            {/* Coaching role — matches coach_specialization, not position */}
            {fields.includes('coachRole') && (
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

            {/* Position (player / all) */}
            {fields.includes('position') && (
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

            {/* Hockey category — coaches/umpires multi-select chips; players single radios */}
            {fields.includes('category') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                {filters.role === 'coach' || filters.role === 'umpire' ? (
                  <div className="flex flex-wrap gap-2">
                    {PLAYING_CATEGORIES.map((cat) => {
                      const active = filters.categories.includes(cat)
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => updateFilter('categories', active
                            ? filters.categories.filter((c) => c !== cat)
                            : [...filters.categories, cat])}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            active ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {CATEGORY_LABELS[cat]}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.categories.length === 0}
                        onChange={() => updateFilter('categories', [])}
                        className="w-4 h-4 text-purple-600"
                      />
                      <span className="text-sm text-gray-700">All</span>
                    </label>
                    {PLAYING_CATEGORIES.map((cat) => (
                      <label key={cat} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={filters.categories.length === 1 && filters.categories[0] === cat}
                          onChange={() => updateFilter('categories', [cat])}
                          className="w-4 h-4 text-purple-600"
                        />
                        <span className="text-sm text-gray-700">{CATEGORY_LABELS[cat]}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Officiating type — umpire (officiating_specialization) */}
            {fields.includes('officiating') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Officiating</label>
                <div className="flex flex-wrap gap-2">
                  {(['outdoor', 'indoor', 'both'] as const).map((spec) => {
                    const active = filters.officiatingSpecializations.includes(spec)
                    return (
                      <button
                        key={spec}
                        type="button"
                        onClick={() => updateFilter('officiatingSpecializations', active
                          ? filters.officiatingSpecializations.filter((s) => s !== spec)
                          : [...filters.officiatingSpecializations, spec])}
                        className={`px-3 py-1.5 rounded-full text-sm border capitalize transition-colors ${
                          active ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {spec}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Location — country (base_country_id) + free-text city narrower */}
            {fields.includes('location') && (
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
            )}

            {/* Open opportunities — club only. Segmented Any / For players / For
                coaches (folds the separate recruiting-players/coaches asks into
                one control); server-side via p_open_opportunity_type. */}
            {fields.includes('openOpportunities') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Open opportunities</label>
                <div className="flex flex-wrap gap-2">
                  {([['any', 'Any'], ['player', 'For players'], ['coach', 'For coaches']] as const).map(([val, label]) => {
                    const active = filters.clubOpportunityType === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => updateFilter('clubOpportunityType', active ? null : val)}
                        aria-pressed={active ? 'true' : 'false'}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          active
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1">Clubs with an open opportunity right now.</p>
              </div>
            )}

            {/* Nationality — dual-aware (either primary or secondary) */}
            {fields.includes('nationality') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nationality</label>
                <CountryMultiSelect
                  value={filters.nationalityCountryIds}
                  onChange={(ids) => updateFilter('nationalityCountryIds', ids)}
                  placeholder="Add nationalities"
                />
              </div>
            )}

            {/* EU-eligible — derived from nationality (dual-aware) */}
            {fields.includes('eu') && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.euOnly}
                    onChange={() => updateFilter('euOnly', !filters.euOnly)}
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">EU-eligible only</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">Has at least one EU nationality.</p>
              </div>
            )}

            {/* Has video — player-only, count-labelled (coverage is thin, so a
                bare toggle could read as a broken grid; the count makes it a
                deliberate narrow). Default off. */}
            {fields.includes('hasVideo') && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.hasVideo}
                    onChange={() => updateFilter('hasVideo', !filters.hasVideo)}
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Has video{typeof videoCount === 'number' ? ` (${videoCount})` : ''}
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">Players with a highlight or full-game video.</p>
              </div>
            )}

            {/* Enough evidence or more — player/coach opt-in narrow over the
                weighted Proven-lens evidence model. Never the default view. */}
            {fields.includes('evidence') && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.evidenceEnoughOnly}
                    onChange={() => updateFilter('evidenceEnoughOnly', !filters.evidenceEnoughOnly)}
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Enough evidence or more</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">Strong or Enough verifiable evidence (video, references, level).</p>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="px-5 py-4 border-t border-gray-100 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="w-full min-h-[44px] rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              {ctaLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )

  return createPortal(sheet, document.body)
}
