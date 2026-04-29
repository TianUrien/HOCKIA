import type { ParsedFilters } from '@/hooks/useDiscover'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { categoryToDisplay } from '@/lib/hockeyCategories'

interface DiscoverFilterChipsProps {
  filters: ParsedFilters
}

/** Renders the LLM-parsed search filters as readable chips. */
export default function DiscoverFilterChips({ filters }: DiscoverFilterChipsProps) {
  const chips: { label: string; color: string }[] = []

  if (filters.roles?.length) {
    filters.roles.forEach(r => chips.push({
      label: r.charAt(0).toUpperCase() + r.slice(1),
      color: r === 'player' ? 'bg-blue-100 text-blue-800'
        : r === 'coach' ? 'bg-teal-100 text-teal-800'
        : r === 'club' ? 'bg-orange-100 text-orange-800'
        : 'bg-rose-100 text-rose-800',
    }))
  }

  if (filters.positions?.length) {
    filters.positions.forEach(p => chips.push({
      label: p.charAt(0).toUpperCase() + p.slice(1),
      color: 'bg-purple-100 text-purple-800',
    }))
  }

  // Phase 3e — show the new category chip if the LLM emitted one. Fall back
  // to legacy gender (translated to the new label) so an in-flight stale
  // backend response still renders sensible text.
  const categoryLabel = filters.target_category
    ? categoryToDisplay(filters.target_category)
    : filters.gender
      ? (filters.gender === 'Men' ? 'Adult Men' : filters.gender === 'Women' ? 'Adult Women' : null)
      : null
  if (categoryLabel) {
    chips.push({ label: categoryLabel, color: 'bg-gray-100 text-gray-800' })
  }

  if (filters.min_age != null || filters.max_age != null) {
    const ageLabel = filters.min_age != null && filters.max_age != null
      ? `${filters.min_age}–${filters.max_age} yrs`
      : filters.max_age != null
        ? `U${filters.max_age + 1}`
        : `${filters.min_age}+ yrs`
    chips.push({ label: ageLabel, color: 'bg-amber-100 text-amber-800' })
  }

  if (filters.eu_passport) {
    chips.push({ label: 'EU Passport', color: 'bg-blue-100 text-blue-800' })
  }

  if (filters.nationalities?.length) {
    filters.nationalities.forEach(n => chips.push({
      label: n,
      color: 'bg-green-100 text-green-800',
    }))
  }

  if (filters.locations?.length) {
    filters.locations.forEach(l => chips.push({
      label: `Based in ${l}`,
      color: 'bg-cyan-100 text-cyan-800',
    }))
  }

  if (filters.availability) {
    const label = filters.availability === 'open_to_play' ? 'Open to play'
      : filters.availability === 'open_to_coach' ? 'Open to coach'
      : 'Open to opportunities'
    chips.push({ label, color: 'bg-emerald-100 text-emerald-800' })
  }

  if (filters.min_references != null) {
    chips.push({ label: `${filters.min_references}+ references`, color: 'bg-violet-100 text-violet-800' })
  }

  if (filters.min_career_entries != null) {
    chips.push({ label: `${filters.min_career_entries}+ career entries`, color: 'bg-indigo-100 text-indigo-800' })
  }

  if (filters.leagues?.length) {
    filters.leagues.forEach(l => chips.push({
      label: l,
      color: 'bg-yellow-100 text-yellow-800',
    }))
  }

  if (filters.coach_specializations?.length) {
    filters.coach_specializations.forEach(s => chips.push({
      label: getSpecializationLabel(s),
      color: 'bg-teal-100 text-teal-800',
    }))
  }

  if (filters.countries?.length) {
    filters.countries.forEach(c => chips.push({
      label: `Playing in ${c}`,
      color: 'bg-sky-100 text-sky-800',
    }))
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${chip.color}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  )
}
