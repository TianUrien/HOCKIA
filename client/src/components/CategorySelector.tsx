import {
  ANY_CATEGORY,
  CATEGORY_LABELS,
  PLAYING_CATEGORIES,
  type PlayingCategory,
  type CoachUmpireCategory,
  isOpenToAny,
} from '@/lib/hockeyCategories'

const RADIO_GRID_CLASS =
  'grid grid-cols-2 sm:grid-cols-3 gap-2'

const buttonClass = (active: boolean) =>
  `p-3 rounded-lg border-2 text-center transition-all text-sm font-medium ${
    active
      ? 'border-hockia-primary bg-purple-50 text-hockia-primary'
      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
  }`

interface PlayingCategorySelectorProps {
  /** Currently selected category, or null. */
  value: PlayingCategory | null
  /** Called with the new category when the user picks one. */
  onChange: (next: PlayingCategory) => void
  /** Optional id for the underlying group (used for aria-labelledby). */
  idPrefix?: string
  /** Disable interaction (e.g. while saving). */
  disabled?: boolean
}

/** Single-select playing category for a player. Renders the 5 categories
 * (no "Any" — players are on one team). Visual language matches the
 * existing Specialization toggle in onboarding. */
export function PlayingCategorySelector({
  value,
  onChange,
  idPrefix = 'playing-category',
  disabled = false,
}: PlayingCategorySelectorProps) {
  return (
    <div role="radiogroup" aria-labelledby={`${idPrefix}-label`} className={RADIO_GRID_CLASS}>
      {PLAYING_CATEGORIES.map((cat) => {
        const active = value === cat
        return (
          <button
            key={cat}
            type="button"
            role="radio"
            aria-checked={active}
            id={`${idPrefix}-${cat}`}
            disabled={disabled}
            onClick={() => onChange(cat)}
            className={buttonClass(active)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        )
      })}
    </div>
  )
}

interface MultiCategorySelectorProps {
  /** Current selection. ['any'] means open-to-all; otherwise a list of specific
   * categories (or null when nothing has been picked yet). */
  value: CoachUmpireCategory[] | null
  /** Called with the new selection. The component enforces the "any is exclusive"
   * rule — the parent never has to handle a mix. */
  onChange: (next: CoachUmpireCategory[]) => void
  /** Optional id for the group (used for aria-labelledby). */
  idPrefix?: string
  /** Disable interaction (e.g. while saving). */
  disabled?: boolean
}

/** Multi-select category selector for coaches and umpires. Renders the 5
 * specific categories as checkboxes plus a separate "Any category" toggle.
 * Picking "Any" clears specific selections; picking a specific category
 * clears "Any". Empty array is normalized to []; the parent persists null
 * if it wants to mean "not yet specified". */
export function MultiCategorySelector({
  value,
  onChange,
  idPrefix = 'categories',
  disabled = false,
}: MultiCategorySelectorProps) {
  const safeValue: CoachUmpireCategory[] = value ?? []
  const isAny = isOpenToAny(safeValue)

  const toggleSpecific = (cat: CoachUmpireCategory) => {
    if (isAny) {
      // Picking a specific category implicitly turns "Any" off.
      onChange([cat])
      return
    }
    if (safeValue.includes(cat)) {
      const next = safeValue.filter((c) => c !== cat)
      onChange(next)
    } else {
      onChange([...safeValue, cat])
    }
  }

  const toggleAny = () => {
    if (isAny) {
      onChange([])
    } else {
      onChange([ANY_CATEGORY])
    }
  }

  return (
    <div className="space-y-3" aria-labelledby={`${idPrefix}-label`}>
      <div role="group" aria-labelledby={`${idPrefix}-label`} className={RADIO_GRID_CLASS}>
        {PLAYING_CATEGORIES.map((cat) => {
          const active = !isAny && safeValue.includes(cat)
          return (
            <button
              key={cat}
              type="button"
              role="checkbox"
              aria-checked={active}
              id={`${idPrefix}-${cat}`}
              disabled={disabled || isAny}
              onClick={() => toggleSpecific(cat)}
              className={`${buttonClass(active)} ${
                isAny ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id={`${idPrefix}-any`}
          checked={isAny}
          disabled={disabled}
          onChange={toggleAny}
          className="w-4 h-4 rounded border-gray-300 text-hockia-primary focus:ring-hockia-primary"
        />
        <label htmlFor={`${idPrefix}-any`} className="text-sm text-gray-700 select-none cursor-pointer">
          {CATEGORY_LABELS.any}{' '}
          <span className="text-gray-400 font-normal">— open to all categories</span>
        </label>
      </div>
    </div>
  )
}
