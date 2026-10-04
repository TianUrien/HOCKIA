import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  selected?: boolean
}

/**
 * Chip (Figma "03 · Components" 459:184): a 36 pt pill with a 44 pt hit area
 * (the ::before slop, per the 2026-10-02 convention). Unselected = grey
 * surface, ink text; selected = soft brand fill, brand text (founder ruling
 * 2026-10-04: the screen's one Primary stays the only solid-purple shape). Used for filters,
 * single-choice options and the follow-up suggestions in Hockia AI.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { label, selected = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-row font-semibold transition-colors',
        "before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
        selected
          ? 'bg-brand-soft text-brand-primary active:bg-brand-soft-pressed'
          : 'bg-surface-grouped text-ink-1 active:bg-surface-muted-pressed',
        className,
      )}
      {...rest}
    >
      {label}
    </button>
  )
})
