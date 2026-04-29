import { X, SlidersHorizontal } from 'lucide-react'
import { opportunityGenderToDisplay, OPPORTUNITY_GENDERS, type OpportunityGender } from '@/lib/hockeyCategories'

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

/** Filter chip-row gender type. Phase 3d — accepts the full enum. */
export type QuickFilterGender = 'all' | OpportunityGender

interface QuickFiltersProps {
  opportunityType: 'all' | 'player' | 'coach'
  gender: QuickFilterGender
  position: string[]
  onSetType: (type: 'all' | 'player' | 'coach') => void
  onSetGender: (gender: QuickFilterGender) => void
  onTogglePosition: (position: string) => void
  onClearAll: () => void
  hasActiveFilters: boolean
  secondaryFilterCount: number
  onOpenMoreFilters: () => void
}

export default function OpportunityQuickFilters({
  opportunityType,
  gender,
  position,
  onSetType,
  onSetGender,
  onTogglePosition,
  onClearAll,
  hasActiveFilters,
  secondaryFilterCount,
  onOpenMoreFilters,
}: QuickFiltersProps) {
  const activeChip = 'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium bg-[#8026FA] text-white border border-[#8026FA]'
  const inactiveChip = 'flex-shrink-0 inline-flex items-center px-3 py-2 rounded-full text-sm font-medium bg-white text-gray-700 border border-gray-200 active:bg-gray-100'

  // Cycle through type: all → player → coach → all
  const cycleType = () => {
    if (opportunityType === 'all') onSetType('player')
    else if (opportunityType === 'player') onSetType('coach')
    else onSetType('all')
  }

  // Cycle through category: all → Adult Men → Adult Women → Girls → Boys → Mixed → all.
  // Phase 3d — covers all five enum values for the mobile chip cycle.
  const cycleGender = () => {
    if (gender === 'all') {
      onSetGender(OPPORTUNITY_GENDERS[0])
      return
    }
    const idx = OPPORTUNITY_GENDERS.indexOf(gender)
    const next = OPPORTUNITY_GENDERS[idx + 1]
    onSetGender(next ?? 'all')
  }

  return (
    <div className="lg:hidden overflow-x-auto flex gap-2 pb-2 scrollbar-hide">
      {/* Type chip */}
      {opportunityType !== 'all' ? (
        <button
          onClick={() => onSetType('all')}
          className={activeChip}
        >
          {opportunityType === 'player' ? 'Player' : 'Coach'}
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <button onClick={cycleType} className={inactiveChip}>
          All Types
        </button>
      )}

      {/* Category chip (only for player opportunities) */}
      {opportunityType !== 'coach' && (
        gender !== 'all' ? (
          <button
            onClick={() => onSetGender('all')}
            className={activeChip}
          >
            {opportunityGenderToDisplay(gender)}
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button onClick={cycleGender} className={inactiveChip}>
            Category
          </button>
        )
      )}

      {/* Position chips (only for player opportunities) */}
      {opportunityType !== 'coach' && POSITIONS.map((pos) => (
        <button
          key={pos}
          onClick={() => onTogglePosition(pos)}
          className={position.includes(pos) ? activeChip : inactiveChip}
        >
          {pos.charAt(0).toUpperCase() + pos.slice(1)}
          {position.includes(pos) && <X className="w-3.5 h-3.5" />}
        </button>
      ))}

      {/* More filters chip */}
      <button
        onClick={onOpenMoreFilters}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border ${
          secondaryFilterCount > 0
            ? 'bg-[#8026FA]/10 text-[#8026FA] border-[#8026FA]/20'
            : 'bg-white text-gray-700 border-gray-200 active:bg-gray-100'
        }`}
      >
        <SlidersHorizontal className="w-4 h-4" />
        More
        {secondaryFilterCount > 0 && (
          <span className="w-5 h-5 rounded-full bg-[#8026FA] text-white text-[10px] font-bold flex items-center justify-center">
            {secondaryFilterCount}
          </span>
        )}
      </button>

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          onClick={onClearAll}
          className="flex-shrink-0 inline-flex items-center px-3 py-2 rounded-full text-sm font-medium text-red-500 bg-red-50 border border-red-100 active:bg-red-100"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
