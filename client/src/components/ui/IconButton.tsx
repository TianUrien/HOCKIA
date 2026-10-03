import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Icon button (Figma 459:171). Ghost 44 is the nav-bar style (transparent,
 * 44 pt target) and the default; Muted 36 for secondary row actions; Tonal 36
 * for a selected toggle. The 36 pt styles keep a 44 pt hit area through the
 * pseudo-element, like the small Button.
 */
export type IconButtonStyle = 'ghost' | 'muted' | 'tonal'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon buttons never carry visible text. */
  label: string
  variant?: IconButtonStyle
  /** Icon colour: ink (default) or brand (nav-bar back chevron). Tonal is always brand. */
  tone?: 'ink' | 'brand'
}

const STYLES: Record<IconButtonStyle, string> = {
  ghost: 'h-11 w-11 active:bg-surface-muted',
  muted: "relative h-9 w-9 bg-surface-muted before:absolute before:-inset-1 before:content-[''] active:bg-surface-muted-pressed",
  tonal: "relative h-9 w-9 bg-hockia-soft before:absolute before:-inset-1 before:content-[''] active:bg-surface-muted-pressed",
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', tone = 'ink', className, children, type = 'button', ...rest },
  ref,
) {
  const brand = variant === 'tonal' || tone === 'brand'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-variant={variant}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 disabled:opacity-40',
        STYLES[variant],
        brand ? 'text-hockia-primary' : 'text-ink-1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
