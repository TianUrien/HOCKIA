import { Building2, GraduationCap, MapPin, ShoppingBag, User, Users } from 'lucide-react'
import type { AppliedSearch } from '@/hooks/useDiscover'
import { categoryToDisplay } from '@/lib/hockeyCategories'

interface AppliedSearchStripProps {
  applied: AppliedSearch
}

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
  if (!applied) return null
  const chips: { label: string; key: string }[] = []

  if (applied.entity) {
    chips.push({ key: 'entity', label: applied.entity })
  }
  // Phase 3e — prefer category_label (Adult Women / Girls / etc.). Fall back
  // to legacy gender_label if a stale backend response is in flight, mapping
  // 'Men' → "Adult Men" and 'Women' → "Adult Women" so chip text is consistent.
  const categoryChipLabel = applied.category_label
    ? categoryToDisplay(applied.category_label)
    : applied.gender_label
      ? (applied.gender_label === 'Men' ? 'Adult Men' : 'Adult Women')
      : null
  if (categoryChipLabel) {
    chips.push({ key: 'category', label: categoryChipLabel })
  }
  if (applied.location_label) {
    chips.push({ key: 'location', label: applied.location_label })
  }
  if (applied.age?.max != null) {
    chips.push({ key: 'age', label: `U${applied.age.max + 1}` })
  } else if (applied.age?.min != null) {
    chips.push({ key: 'age', label: `${applied.age.min}+ yrs` })
  }

  if (chips.length === 0) return null
  const EntityIcon = applied.entity ? ENTITY_ICON[applied.entity] ?? Users : Users

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.04em]">
        <EntityIcon className="w-3 h-3" aria-hidden="true" />
        Searched
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
