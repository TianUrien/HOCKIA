import type { ParsedFilters } from '@/hooks/useDiscover'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { categoryToDisplay, opportunityGenderToDisplay } from '@/lib/hockeyCategories'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'
import { hasEnumsKey, useEnumsT } from '@/i18n/ns/enums'

/** Specializations whose shared label reads differently from the token ("Strength & conditioning"): keep the token's words. */
const OWN_WORDING = new Set(['strength_conditioning', 'other_coach'])

interface DiscoverFilterChipsProps {
  filters: ParsedFilters
}

/** Renders the LLM-parsed search filters as readable chips. */
export default function DiscoverFilterChips({ filters }: DiscoverFilterChipsProps) {
  const t = useHockiaAiT()
  const te = useEnumsT()
  const chips: { label: string; color: string }[] = []

  if (filters.roles?.length) {
    filters.roles.forEach(r => chips.push({
      label: hasEnumsKey(`role.${r}`) ? te(`role.${r}` as never) : r.charAt(0).toUpperCase() + r.slice(1),
      color: r === 'player' ? 'bg-hockia-soft text-brand-text'
        : r === 'coach' ? 'bg-hockia-soft text-brand-text'
        : r === 'club' ? 'bg-hockia-soft text-brand-text'
        : 'bg-hockia-soft text-brand-text',
    }))
  }

  if (filters.positions?.length) {
    // Positions arrive as enum values ("head_coach") — never show those raw.
    filters.positions.forEach(p => chips.push({
      label: hasEnumsKey(`position.${p}`) ? te(`position.${p}` as never)
        : !OWN_WORDING.has(p) && hasEnumsKey(`coachSpecialization.${p}`) ? te(`coachSpecialization.${p}` as never)
        : (p.charAt(0).toUpperCase() + p.slice(1)).replace(/_/g, ' '),
      color: 'bg-purple-100 text-purple-800',
    }))
  }

  // Phase 3e — show the new category chip if the LLM emitted one. Fall back
  // to legacy gender (translated to the new label) so an in-flight stale
  // backend response still renders sensible text.
  const categoryLabel = filters.target_category
    ? categoryToDisplay(filters.target_category)
    : filters.gender
      ? (opportunityGenderToDisplay(filters.gender) || null)
      : null
  if (categoryLabel) {
    chips.push({ label: categoryLabel, color: 'bg-gray-100 text-gray-800' })
  }

  if (filters.min_age != null || filters.max_age != null) {
    const ageLabel = filters.min_age != null && filters.max_age != null
      ? t('discover.ageRange', { min: filters.min_age, max: filters.max_age })
      : filters.max_age != null
        ? t('discover.ageUnder', { age: filters.max_age + 1 })
        : t('discover.ageMin', { min: filters.min_age })
    chips.push({ label: ageLabel, color: 'bg-hockia-soft text-hockia-primary' })
  }

  if (filters.eu_passport) {
    chips.push({ label: t('discover.euPassport'), color: 'bg-hockia-soft text-brand-text' })
  }

  if (filters.nationalities?.length) {
    filters.nationalities.forEach(n => chips.push({
      label: n,
      color: 'bg-hockia-soft text-brand-text',
    }))
  }

  if (filters.locations?.length) {
    filters.locations.forEach(l => chips.push({
      label: t('discover.basedInPlace', { place: l }),
      color: 'bg-hockia-soft text-brand-text',
    }))
  }

  if (filters.availability) {
    const label = filters.availability === 'open_to_play' ? t('discover.openToPlay')
      : filters.availability === 'open_to_coach' ? t('discover.openToCoach')
      : t('discover.openToOpportunities')
    chips.push({ label, color: 'bg-hockia-soft text-brand-text' })
  }

  if (filters.min_references != null) {
    chips.push({ label: t('discover.minReferences', { count: filters.min_references }), color: 'bg-hockia-soft text-brand-text' })
  }

  if (filters.min_career_entries != null) {
    chips.push({ label: t('discover.minCareer', { count: filters.min_career_entries }), color: 'bg-hockia-soft text-brand-text' })
  }

  if (filters.leagues?.length) {
    filters.leagues.forEach(l => chips.push({
      label: l,
      color: 'bg-hockia-soft text-hockia-primary',
    }))
  }

  if (filters.coach_specializations?.length) {
    filters.coach_specializations.forEach(s => chips.push({
      label: getSpecializationLabel(s),
      color: 'bg-hockia-soft text-brand-text',
    }))
  }

  if (filters.countries?.length) {
    filters.countries.forEach(c => chips.push({
      label: t('discover.playingIn', { country: c }),
      color: 'bg-hockia-soft text-brand-text',
    }))
  }

  if (chips.length === 0) return null

  return (
    <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
      <span className="text-xs font-medium text-gray-500">
        {t('discover.filtersApplied')}
      </span>
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
