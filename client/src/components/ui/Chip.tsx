import { forwardRef } from 'react'
import { chipTone } from '@/components/ui/chipClasses'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  selected?: boolean
  /** A small leading mark before the label (e.g. the category colour dot). */
  leading?: ReactNode
}

/**
 * Chip (Figma "03 · Components" 459:184): a 36 pt pill with a 44 pt hit area
 * (the ::before slop, per the 2026-10-02 convention). Unselected = outline
 * on white (audit A4, 2026-10-21), ink text; selected = soft brand fill, brand text (founder ruling
 * 2026-10-04: the screen's one Primary stays the only solid-purple shape). Used for filters,
 * single-choice options and the follow-up suggestions in Hockia AI.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { label, selected = false, leading, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-row font-semibold transition-colors',
        "before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
        chipTone(selected),
        selected ? 'active:bg-brand-soft-pressed' : 'active:bg-surface-muted',
        className,
      )}
      {...rest}
    >
      {leading}
      {label}
    </button>
  )
})
