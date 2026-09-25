import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { PACKAGE_FILTER_KEYS, PACKAGE_FILTER_LABELS, type PackageFilterKey } from '@/lib/opportunityCopy'
import { EMPTY_ROLE_FILTERS, type RoleFilters } from '@/lib/opportunityFilters'
import { cn } from '@/lib/utils'

interface OpportunityFiltersSheetProps {
  open: boolean
  onClose: () => void
  value: RoleFilters
  onApply: (next: RoleFilters) => void
  /** Live count for the draft filters — the button says "Show N roles". */
  countFor: (draft: RoleFilters) => number
  /** "Argentine — 4 of 14 open roles" under the passport toggle; null hides the toggle. */
  passportHint: string | null
}

const POSITIONS = [
  { value: '', label: 'Any' },
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
]
// No Girls/Boys: player roles are adult-only (founder ruling 2026-09-25).
const CATEGORIES = [
  { value: 'Women', label: "Women's" },
  { value: 'Men', label: "Men's" },
  { value: 'Mixed', label: 'Mixed' },
]

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-9 items-center rounded-full px-3.5 text-row font-semibold transition-colors',
        active ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Filters sheet (Figma Opportunities — Filters): Type, Position, Category,
 * Package (nine benefits), and the passport toggle. Live count on the button.
 */
export function OpportunityFiltersSheet({ open, onClose, value, onApply, countFor, passportHint }: OpportunityFiltersSheetProps) {
  const [draft, setDraft] = useState<RoleFilters>(value)
  useEffect(() => { if (open) setDraft(value) }, [open, value])

  const togglePackage = (key: PackageFilterKey) =>
    setDraft((d) => ({ ...d, package: d.package.includes(key) ? d.package.filter((k) => k !== key) : [...d.package, key] }))

  const count = countFor(draft)

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Filters">
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-title text-ink-1">Filters</h2>
          <button type="button" onClick={() => setDraft(EMPTY_ROLE_FILTERS)} className="text-row font-semibold text-hockia-primary">
            Reset
          </button>
        </div>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Type</h3>
          <div className="flex flex-wrap gap-2">
            <Chip active={draft.type === 'player'} onClick={() => setDraft((d) => ({ ...d, type: d.type === 'player' ? 'all' : 'player' }))}>Player roles</Chip>
            <Chip active={draft.type === 'coach'} onClick={() => setDraft((d) => ({ ...d, type: d.type === 'coach' ? 'all' : 'coach', position: '', gender: '' }))}>Coach roles</Chip>
          </div>
        </section>

        {draft.type !== 'coach' && (
          <>
            <section className="flex flex-col gap-2.5">
              <h3 className="text-row font-semibold text-ink-1">Position</h3>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <Chip key={p.value || 'any'} active={draft.position === p.value} onClick={() => setDraft((d) => ({ ...d, position: p.value }))}>{p.label}</Chip>
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className="text-row font-semibold text-ink-1">Category</h3>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <Chip key={c.value} active={draft.gender === c.value} onClick={() => setDraft((d) => ({ ...d, gender: d.gender === c.value ? '' : c.value }))}>{c.label}</Chip>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Package</h3>
          <div className="flex flex-wrap gap-2">
            {PACKAGE_FILTER_KEYS.map((key) => (
              <Chip key={key} active={draft.package.includes(key)} onClick={() => togglePackage(key)}>{PACKAGE_FILTER_LABELS[key]}</Chip>
            ))}
          </div>
        </section>

        {passportHint && (
          <button
            type="button"
            role="switch"
            aria-checked={draft.eligibleOnly}
            onClick={() => setDraft((d) => ({ ...d, eligibleOnly: !d.eligibleOnly }))}
            className="flex items-center gap-3 rounded-card bg-surface-grouped px-3.5 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-row font-semibold text-ink-1">Only roles my passports qualify for</span>
              <span className="block truncate text-secondary text-ink-2">{passportHint}</span>
            </span>
            <span className={cn('flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold', draft.eligibleOnly ? 'bg-positive-soft text-positive' : 'bg-white text-ink-2')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', draft.eligibleOnly ? 'bg-positive' : 'bg-ink-4')} />
              {draft.eligibleOnly ? 'On' : 'Off'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => { onApply(draft); onClose() }}
          className="mt-1 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white"
        >
          {count === 1 ? 'Show 1 role' : `Show ${count} roles`}
        </button>
      </div>
    </BottomSheet>
  )
}
