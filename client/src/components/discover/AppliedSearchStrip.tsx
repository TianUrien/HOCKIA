import { Building2, GraduationCap, MapPin, ShoppingBag, User, Users } from 'lucide-react'
import type { AppliedSearch } from '@/hooks/useDiscover'
import { categoryToDisplay, opportunityGenderToDisplay } from '@/lib/hockeyCategories'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'

interface AppliedSearchStripProps {
  applied: AppliedSearch
}

const ENTITY_KEYS = {
  clubs: 'discover.entity.clubs',
  players: 'discover.entity.players',
  coaches: 'discover.entity.coaches',
  brands: 'discover.entity.brands',
  umpires: 'discover.entity.umpires',
} as const

const ENTITY_ICON: Record<string, typeof Building2> = {
  clubs: Building2,
  players: User,
  coaches: GraduationCap,
  brands: ShoppingBag,
  umpires: Users,
}

/**
 * Tiny chip strip rendered above the no-results / results body so the user
 * can see at a glance what was actually searched. Read-only in PR-2;
 * Package B will make these tappable to drop individual filters.
 */
export default function AppliedSearchStrip({ applied }: AppliedSearchStripProps) {
  const t = useHockiaAiT()
  if (!applied) return null
  const chips: { label: string; key: string }[] = []

  if (applied.entity) {
    const entityKey = ENTITY_KEYS[applied.entity as keyof typeof ENTITY_KEYS]
    chips.push({ key: 'entity', label: entityKey ? t(entityKey) : applied.entity })
  }
  // Phase 3e — prefer category_label (Adult women / Girls / etc.). Fall back
  // to legacy gender_label if a stale backend response is in flight, mapping
  // 'Men' → "Men's" and 'Women' → "Women's" so chip text is consistent.
  const categoryChipLabel = applied.category_label
    ? categoryToDisplay(applied.category_label)
    : applied.gender_label
      ? (opportunityGenderToDisplay(applied.gender_label) || null)
      : null
  if (categoryChipLabel) {
    chips.push({ key: 'category', label: categoryChipLabel })
  }
  if (applied.location_label) {
    chips.push({ key: 'location', label: applied.location_label })
  }
  if (applied.age?.max != null) {
    chips.push({ key: 'age', label: t('discover.ageUnder', { age: applied.age.max + 1 }) })
  } else if (applied.age?.min != null) {
    chips.push({ key: 'age', label: t('discover.ageMin', { min: applied.age.min }) })
  }

  if (chips.length === 0) return null
  const EntityIcon = applied.entity ? ENTITY_ICON[applied.entity] ?? Users : Users

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.04em]">
        <EntityIcon className="w-3 h-3" aria-hidden="true" />
        {t('discover.searched')}
      </span>
      {chips.map(c => (
        <span
          key={c.key}
          className="inline-flex items-center px-2 py-[3px] rounded-full bg-gray-100 text-gray-700 font-medium text-[11px]"
        >
          {c.key === 'location' ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {c.label}
            </span>
          ) : (
            c.label
          )}
        </span>
      ))}
    </div>
  )
}
