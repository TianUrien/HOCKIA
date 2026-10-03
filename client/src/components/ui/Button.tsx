import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared button (Figma "Button" 459:146; decision 2026-10-02): seven styles,
 * Large 48 / Small 36, loading state, 44 pt hit area. One Primary per screen,
 * sheet or card; Tonal for actions repeated in rows; Secondary = equal-weight
 * alternative; Tertiary = neutral low-emphasis text; Link = brand inline text;
 * Destructive (soft) opens a negative action, Danger (solid) confirms it.
 *
 * The Small size is 36 pt visually with a 44 pt hit area (pseudo-element), per
 * the documented convention. Unlike the legacy `components/Button.tsx`, this
 * one carries the Figma tokens and no gradients.
 */
export type ButtonStyle = 'primary' | 'tonal' | 'secondary' | 'tertiary' | 'link' | 'destructive' | 'danger'
export type ButtonSize = 'large' | 'small'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonStyle
  size?: ButtonSize
  loading?: boolean
  /** Stretch to the container width (stacked phone actions). */
  block?: boolean
  icon?: ReactNode
}

const STYLES: Record<ButtonStyle, string> = {
  primary: 'bg-hockia-primary text-white hover:bg-brand-primary-hover active:bg-brand-primary-pressed',
  tonal: 'bg-hockia-soft text-hockia-primary active:bg-surface-muted-pressed',
  secondary: 'bg-white text-ink-1 ring-1 ring-inset ring-line active:bg-surface-muted',
  tertiary: 'bg-transparent text-ink-2 active:bg-surface-muted',
  link: 'bg-transparent text-hockia-primary underline-offset-2 hover:underline',
  destructive: 'bg-status-danger-soft text-status-danger active:opacity-80',
  danger: 'bg-status-danger text-white active:opacity-90',
}

const SIZES: Record<ButtonSize, string> = {
  large: 'h-12 px-5 text-body font-semibold rounded-[12px]',
  // 36 pt visual, 44 pt hit area via the pseudo-element.
  small: "relative h-9 px-3.5 text-row font-semibold rounded-[10px] before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
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
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 disabled:opacity-40',
        STYLES[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  )
})
