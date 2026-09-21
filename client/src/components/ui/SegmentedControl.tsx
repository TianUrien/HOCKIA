import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Rendered as "Label · N" when > 0 (Figma: "Requests · 4"). */
  count?: number
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/**
 * iOS-style segmented control (Figma 03 Player: Inbox, My applications,
 * Opportunities "Applied"). Grey track, white selected pill with a soft
 * shadow. Use for 2–4 mutually exclusive views of the same screen; anything
 * else is a filters button (design rule from 00 Architecture).
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
      className={cn('flex gap-0.5 rounded-[9px] bg-surface-grouped p-0.5', className)}
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
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-[30px] flex-1 items-center justify-center rounded-tile text-secondary transition-colors',
              active
                ? 'bg-white font-semibold text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.10)]'
                : 'font-medium text-ink-2 active:text-ink-1',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
