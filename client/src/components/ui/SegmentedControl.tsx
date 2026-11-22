import { cn } from '@/lib/utils'
import { useCommonT } from '@/i18n/ns/common'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Shown instead of `label` below 640 px, so the segment stays on one line
   *  on every phone ("Open (24)" for "Open opportunities (24)"). It was 430 px,
   *  but on the widest phones (440 pt) the long Spanish label still did not
   *  fit half the track. Screen readers always get the full label. */
  shortLabel?: string
  /** Rendered as "Label · N" when > 0 (Figma: "Requests · 4"). */
  count?: number
  /** Small violet "new" dot after the label, no number (Inbox segments; rebrand: no red counters). */
  dot?: boolean
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/**
 * Segmented control (rebrand 2026-10-25, Figma Segmented control 72:432):
 * a 48 pill track (bg/subtle, 4 padding) with 40-high items; the active item
 * is a white pill with Elevation/1, ink-1; the others ink-2. Labels are
 * UI/Label (14 medium). Use for 2–4 mutually exclusive views of the same
 * screen; anything else is a filters button (design rule from 00
 * Architecture).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const t = useCommonT()
  // Two segments share the width equally; in a container that hugs its
  // content (desktop headers) the grid sizes both to the longer label, so
  // neither is cut. Three or more take the room their label needs, with
  // tighter padding on narrow phones: equal thirds cut the longer Spanish
  // labels ("Oportunidades", "Postulaciones") while a short one had room to spare.
  const many = options.length >= 3
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('gap-1 rounded-full bg-surface-muted p-1', many ? 'flex' : 'grid auto-cols-[minmax(0,1fr)] grid-flow-col', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        const withCount = (text: string) =>
          typeof option.count === 'number' && option.count > 0 ? t('segmented.withCount', { label: text, count: option.count }) : text
        const label = withCount(option.label)
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.dot ? t('segmented.newLabel', { label }) : option.shortLabel ? label : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-full font-medium leading-[18px] transition-colors',
              many ? 'flex-auto px-2 text-[13px] min-[430px]:px-3.5 min-[430px]:text-[14px]' : 'px-3.5 text-[14px]',
              active
                ? 'bg-white text-ink-1 shadow-[0_1px_2px_rgba(30,10,60,0.04),0_8px_24px_rgba(30,10,60,0.08)]'
                : 'text-ink-2 active:text-ink-1',
            )}
          >
            {option.shortLabel ? (
              <>
                <span className="truncate sm:hidden">{withCount(option.shortLabel)}</span>
                <span className="hidden truncate sm:inline">{label}</span>
              </>
            ) : (
              <span className="truncate">{label}</span>
            )}
            {option.dot && (
              <span aria-hidden="true" data-testid={`segment-dot-${option.value}`} className="ml-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />
            )}
          </button>
        )
      })}
    </div>
  )
}
