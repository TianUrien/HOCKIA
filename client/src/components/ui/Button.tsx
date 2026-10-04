import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { buttonClassName, type ButtonSize, type ButtonStyle } from './buttonClasses'

/**
 * Shared button (Figma "Button" 459:146; decision 2026-10-02): seven styles,
 * Large 48 / Small 36, loading state, 44 pt hit area. One Primary per screen,
 * sheet or card; Tonal for actions repeated in rows; Secondary = equal-weight
 * alternative; Tertiary = neutral low-emphasis text; Link = brand inline text;
 * Destructive (soft) opens a negative action, Danger (solid) confirms it.
 *
 * The Small size is 36 pt visually with a 44 pt hit area (pseudo-element), per
 * the documented convention. Unlike the legacy `components/Button.tsx`, this
 * one carries the Figma tokens and no gradients. The classes themselves live
 * in `buttonClasses.ts` (shared with link-shaped CTAs).
 */
export type { ButtonSize, ButtonStyle } from './buttonClasses'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonStyle
  size?: ButtonSize
  loading?: boolean
  /** Stretch to the container width (stacked phone actions). */
  block?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'large', loading = false, block = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, block, className })}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  )
})
