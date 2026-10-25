import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
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
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-1 rounded-full bg-surface-muted p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        const label =
          typeof option.count === 'number' && option.count > 0
            ? `${option.label} · ${option.count}`
            : option.label
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.dot ? `${label}, new` : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-10 flex-1 items-center justify-center rounded-full px-3.5 text-[14px] font-medium leading-[18px] transition-colors',
              active
                ? 'bg-white text-ink-1 shadow-[0_1px_2px_rgba(30,10,60,0.04),0_8px_24px_rgba(30,10,60,0.08)]'
                : 'text-ink-2 active:text-ink-1',
            )}
          >
            {label}
            {option.dot && (
              <span aria-hidden="true" data-testid={`segment-dot-${option.value}`} className="ml-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />
            )}
          </button>
        )
      })}
    </div>
  )
}
