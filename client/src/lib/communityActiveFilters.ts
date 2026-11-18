import type { CommunityFilters, SortOption } from '@/components/community/communityFilters'
import { teamLabel } from '@/lib/communityCard'
import { CATEGORY_LABELS } from '@/lib/hockeyCategories'
import { COACH_SPECIALIZATIONS } from '@/lib/coachSpecializations'
import { tCommunity } from '@/i18n/ns/community'
import { tEnums } from '@/i18n/ns/enums'
import { countryLabel } from '@/i18n/countryNames'

/**
 * One removable active-filter chip shown below the Community search bar. Role is
 * intentionally EXCLUDED — the role/member-type is already shown (with the active
 * state) by the visible role-chip row, so a removable role chip would be
 * redundant and confusing ("remove" = "go back to All").
 */
export interface ActiveFilterChip {
  id: string
  label: string
  onRemove: () => void
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const POSITION_TOKENS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
const OFFICIATING_TOKENS = ['outdoor', 'indoor', 'both'] as const
const BRAND_CATEGORY_TOKENS = ['equipment', 'apparel', 'accessories', 'nutrition', 'technology', 'coaching', 'recruiting', 'media', 'services', 'other'] as const

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value)

/** Chip text for a stored token: the catalog label when known, the title-cased token otherwise. */
const positionChip = (pos: string) => (isOneOf(POSITION_TOKENS, pos) ? tEnums(`position.${pos}`) : titleCase(pos))
const officiatingChip = (off: string) => (isOneOf(OFFICIATING_TOKENS, off) ? tCommunity(`filters.chip.officiating.${off}`) : titleCase(off))
const brandCategoryChip = (cat: string) => (isOneOf(BRAND_CATEGORY_TOKENS, cat) ? tCommunity(`filters.chip.brandCategory.${cat}`) : titleCase(cat))

/**
 * Evidence sort + "Enough evidence+" filter are recruiter tools (founder
 * 2026-09-26): clubs and recruiting coaches only (isRecruitingViewer).
 * For everyone else the option isn't offered, and a sort/filter state that
 * still carries it (session state, a stale link) falls back to the default
 * sort / no filter. These two helpers are the single fallback rule.
 */
export function effectiveCommunitySort(sort: SortOption, canUseEvidence: boolean): SortOption {
  return sort === 'evidence' && !canUseEvidence ? 'newest' : sort
}

export function evidenceFilterActive(
  filters: Pick<CommunityFilters, 'evidenceEnoughOnly'>,
  canUseEvidence: boolean,
): boolean {
  return filters.evidenceEnoughOnly && canUseEvidence
}

/**
 * Derive the active-filter chips from the current filter state. One chip per
 * VALUE for multi-select facets (each position / nationality / etc. removable
 * individually). The chip count is also the "Filters · N" badge number.
 */
export function getActiveFilterChips(
  filters: CommunityFilters,
  countries: { id: number; name: string }[],
  update: <K extends keyof CommunityFilters>(key: K, value: CommunityFilters[K]) => void,
  { canUseEvidence = false }: { canUseEvidence?: boolean } = {},
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  const countryName = (id: number) => countryLabel(countries.find((c) => c.id === id)?.name) ?? `#${id}`

  for (const pos of filters.position) {
    chips.push({ id: `position:${pos}`, label: positionChip(pos), onRemove: () => update('position', filters.position.filter((p) => p !== pos)) })
  }
  for (const spec of filters.coachSpecializations) {
    const label = COACH_SPECIALIZATIONS.find((s) => s.value === spec)?.label ?? spec
    chips.push({ id: `coachSpec:${spec}`, label, onRemove: () => update('coachSpecializations', filters.coachSpecializations.filter((s) => s !== spec)) })
  }
  for (const cat of filters.categories) {
    chips.push({ id: `category:${cat}`, label: teamLabel(cat) ?? CATEGORY_LABELS[cat] ?? cat, onRemove: () => update('categories', filters.categories.filter((c) => c !== cat)) })
  }
  for (const off of filters.officiatingSpecializations) {
    chips.push({ id: `officiating:${off}`, label: officiatingChip(off), onRemove: () => update('officiatingSpecializations', filters.officiatingSpecializations.filter((o) => o !== off)) })
  }
  for (const id of filters.locationCountryIds) {
    chips.push({ id: `loc:${id}`, label: tCommunity('filters.chip.basedIn', { country: countryName(id) }), onRemove: () => update('locationCountryIds', filters.locationCountryIds.filter((x) => x !== id)) })
  }
  if (filters.location.trim()) {
    chips.push({ id: 'locationText', label: filters.location.trim(), onRemove: () => update('location', '') })
  }
  for (const id of filters.nationalityCountryIds) {
    chips.push({ id: `nat:${id}`, label: tCommunity('filters.chip.nationality', { country: countryName(id) }), onRemove: () => update('nationalityCountryIds', filters.nationalityCountryIds.filter((x) => x !== id)) })
  }
  if (filters.euOnly) {
    chips.push({ id: 'eu', label: tCommunity('filters.chip.euEligible'), onRemove: () => update('euOnly', false) })
  }
  if (filters.hasVideo) {
    chips.push({ id: 'hasVideo', label: tCommunity('filters.chip.hasVideo'), onRemove: () => update('hasVideo', false) })
  }
  if (evidenceFilterActive(filters, canUseEvidence)) {
    chips.push({ id: 'evidence', label: tCommunity('filters.chip.evidence'), onRemove: () => update('evidenceEnoughOnly', false) })
  }
  if (filters.availability !== 'all') {
    const label = tCommunity(`filters.chip.availability.${filters.availability}`)
    chips.push({ id: 'availability', label, onRemove: () => update('availability', 'all') })
  }
  if (filters.brandCategory) {
    chips.push({ id: 'brandCategory', label: brandCategoryChip(filters.brandCategory), onRemove: () => update('brandCategory', null) })
  }
  if (filters.clubOpportunityType) {
    const label = filters.clubOpportunityType === 'player' ? tCommunity('filters.chip.hiringPlayers')
      : filters.clubOpportunityType === 'coach' ? tCommunity('filters.chip.hiringCoaches')
      : tCommunity('filters.chip.openOpportunities')
    chips.push({ id: 'clubOpportunity', label, onRemove: () => update('clubOpportunityType', null) })
  }

  return chips
}
