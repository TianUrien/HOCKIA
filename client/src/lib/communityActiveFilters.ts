import type { CommunityFilters } from '@/components/community/communityFilters'
import { CATEGORY_LABELS } from '@/lib/hockeyCategories'
import { COACH_SPECIALIZATIONS } from '@/lib/coachSpecializations'
import { availabilityFilterLabel } from '@/lib/availabilityLabel'

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

/**
 * Derive the active-filter chips from the current filter state. One chip per
 * VALUE for multi-select facets (each position / nationality / etc. removable
 * individually). The chip count is also the "Filters · N" badge number.
 */
export function getActiveFilterChips(
  filters: CommunityFilters,
  countries: { id: number; name: string }[],
  update: <K extends keyof CommunityFilters>(key: K, value: CommunityFilters[K]) => void,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  const countryName = (id: number) => countries.find((c) => c.id === id)?.name ?? `#${id}`

  for (const pos of filters.position) {
    chips.push({ id: `position:${pos}`, label: titleCase(pos), onRemove: () => update('position', filters.position.filter((p) => p !== pos)) })
  }
  for (const spec of filters.coachSpecializations) {
    const label = COACH_SPECIALIZATIONS.find((s) => s.value === spec)?.label ?? spec
    chips.push({ id: `coachSpec:${spec}`, label, onRemove: () => update('coachSpecializations', filters.coachSpecializations.filter((s) => s !== spec)) })
  }
  for (const cat of filters.categories) {
    chips.push({ id: `category:${cat}`, label: CATEGORY_LABELS[cat] ?? cat, onRemove: () => update('categories', filters.categories.filter((c) => c !== cat)) })
  }
  for (const off of filters.officiatingSpecializations) {
    chips.push({ id: `officiating:${off}`, label: titleCase(off), onRemove: () => update('officiatingSpecializations', filters.officiatingSpecializations.filter((o) => o !== off)) })
  }
  for (const id of filters.locationCountryIds) {
    chips.push({ id: `loc:${id}`, label: countryName(id), onRemove: () => update('locationCountryIds', filters.locationCountryIds.filter((x) => x !== id)) })
  }
  if (filters.location.trim()) {
    chips.push({ id: 'locationText', label: filters.location.trim(), onRemove: () => update('location', '') })
  }
  for (const id of filters.nationalityCountryIds) {
    chips.push({ id: `nat:${id}`, label: countryName(id), onRemove: () => update('nationalityCountryIds', filters.nationalityCountryIds.filter((x) => x !== id)) })
  }
  if (filters.euOnly) {
    chips.push({ id: 'eu', label: 'EU-eligible', onRemove: () => update('euOnly', false) })
  }
  if (filters.availability === 'open') {
    chips.push({ id: 'availability', label: availabilityFilterLabel(filters.role), onRemove: () => update('availability', 'all') })
  }
  if (filters.brandCategory) {
    chips.push({ id: 'brandCategory', label: titleCase(filters.brandCategory), onRemove: () => update('brandCategory', null) })
  }

  return chips
}
