import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { PACKAGE_FILTER_KEYS, PACKAGE_FILTER_LABELS, type PackageFilterKey } from '@/lib/opportunityCopy'
import { EMPTY_ROLE_FILTERS, type RoleFilters } from '@/lib/opportunityFilters'
import { Chip } from '@/components/ui/Chip'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useOpportunitiesT } from '@/i18n/ns/opportunities'

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

// Labels are read from the catalog where the chips render (filters.position.*, filters.category.*).
const POSITIONS = [
  { value: '', labelKey: 'filters.position.any' },
  { value: 'goalkeeper', labelKey: 'filters.position.goalkeeper' },
  { value: 'defender', labelKey: 'filters.position.defender' },
  { value: 'midfielder', labelKey: 'filters.position.midfielder' },
  { value: 'forward', labelKey: 'filters.position.forward' },
] as const
// No Girls/Boys: player roles are adult-only (founder ruling 2026-09-25).
const CATEGORIES = [
  { value: 'Women', labelKey: 'filters.category.women' },
  { value: 'Men', labelKey: 'filters.category.men' },
  { value: 'Mixed', labelKey: 'filters.category.mixed' },
] as const

/**
 * Filters sheet (Figma Opportunities — Filters): Type, Position, Category,
 * Package (nine benefits), and the passport toggle (List item / Switch). Every
 * option is the shared Chip (selected = soft purple); live count on the button.
 */
export function OpportunityFiltersSheet({ open, onClose, value, onApply, countFor, passportHint }: OpportunityFiltersSheetProps) {
  const t = useOpportunitiesT()
  const [draft, setDraft] = useState<RoleFilters>(value)
  useEffect(() => { if (open) setDraft(value) }, [open, value])

  const togglePackage = (key: PackageFilterKey) =>
    setDraft((d) => ({ ...d, package: d.package.includes(key) ? d.package.filter((k) => k !== key) : [...d.package, key] }))

  const count = countFor(draft)

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('filters.title')}>
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-title text-ink-1">{t('filters.title')}</h2>
          <button type="button" onClick={() => setDraft(EMPTY_ROLE_FILTERS)} className="-my-2 flex min-h-[44px] items-center text-row font-semibold text-hockia-primary">
            {t('filters.reset')}
          </button>
        </div>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">{t('filters.type')}</h3>
          <div className="flex flex-wrap gap-2">
            <Chip label={t('filters.playerOpportunities')} selected={draft.type === 'player'} onClick={() => setDraft((d) => ({ ...d, type: d.type === 'player' ? 'all' : 'player' }))} />
            <Chip label={t('filters.coachOpportunities')} selected={draft.type === 'coach'} onClick={() => setDraft((d) => ({ ...d, type: d.type === 'coach' ? 'all' : 'coach', position: '', gender: '' }))} />
          </div>
        </section>

        {draft.type !== 'coach' && (
          <>
            <section className="flex flex-col gap-2.5">
              <h3 className="text-row font-semibold text-ink-1">{t('filters.positionHeading')}</h3>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <Chip key={p.value || 'any'} label={t(p.labelKey)} selected={draft.position === p.value} onClick={() => setDraft((d) => ({ ...d, position: p.value }))} />
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className="text-row font-semibold text-ink-1">{t('filters.categoryHeading')}</h3>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <Chip key={c.value} label={t(c.labelKey)} selected={draft.gender === c.value} onClick={() => setDraft((d) => ({ ...d, gender: d.gender === c.value ? '' : c.value }))} />
                ))}
              </div>
            </section>
          </>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">{t('filters.packageHeading')}</h3>
          <div className="flex flex-wrap gap-2">
            {PACKAGE_FILTER_KEYS.map((key) => (
              <Chip key={key} label={PACKAGE_FILTER_LABELS[key]} selected={draft.package.includes(key)} onClick={() => togglePackage(key)} />
            ))}
          </div>
        </section>

        {passportHint && (
          <SwitchCardRow
            title={t('filters.passportsOnly')}
            description={passportHint}
            checked={draft.eligibleOnly}
            onChange={() => setDraft((d) => ({ ...d, eligibleOnly: !d.eligibleOnly }))}
            testId="opportunity-filter-passports"
          />
        )}

        <button
          type="button"
          onClick={() => { onApply(draft); onClose() }}
          className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-1' })}
          data-testid="opportunity-filter-show"
        >
          {t('filters.show', { count })}
        </button>
      </div>
    </BottomSheet>
  )
}
