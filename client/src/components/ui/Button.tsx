import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { buttonClassName, type ButtonSize, type ButtonStyle } from './buttonClasses'

/**
 * Shared button (rebrand 2026-10-25, Figma Button 13:131): pills, Large 52 /
 * Small 36, 44 pt hit area. One Primary per screen, sheet or card; Ink for the
 * main action when violet is already used (or owner actions); Tonal for
 * actions repeated in rows; Secondary = outline alternative; Tertiary =
 * neutral text; Link = brand inline text; Destructive (soft) opens a negative
 * action, Danger (solid) confirms it. Loading hides the label (keeping the
 * width) and centres a spinner. The classes live in `buttonClasses.ts`.
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
      {loading ? (
        <Loader2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin" aria-hidden="true" />
      ) : null}
      {icon ? <span className={loading ? 'invisible' : undefined}>{icon}</span> : null}
      <span className={loading ? 'invisible' : undefined}>{children}</span>
    </button>
  )
})
