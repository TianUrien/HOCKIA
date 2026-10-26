import { forwardRef } from 'react'
import { Check } from 'lucide-react'
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
 * Chip (rebrand 2026-10-25, Figma Chip / Selectable 74:357): a 44 pt pill
 * (the touch target itself), Inter 14 medium. Unselected = outline on white,
 * ink text; selected = soft violet fill, 1.5 px violet border, violet-700 text
 * and a check (founder ruling 2026-10-04: the screen's one Primary stays the
 * only solid-violet shape). A chip with its own leading mark (the category
 * dot) keeps it instead of the check. Used for filters, single-choice
 * options and the follow-up suggestions in Hockia AI.
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
        'relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium leading-[18px] tracking-[-0.002em] transition-colors',
        chipTone(selected),
        selected ? 'active:bg-brand-soft-pressed' : 'active:bg-surface-muted',
        className,
      )}
      {...rest}
    >
      {leading ?? (selected ? <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> : null)}
      {label}
    </button>
  )
})
