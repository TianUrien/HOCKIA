import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Icon button (Figma 459:171). Ghost 44 is the nav-bar style (transparent,
 * 44 pt target) and the default; Muted 36 for secondary row actions; Tonal 36
 * for a selected toggle; Glass 36 over photos (black 40 % with a backdrop
 * blur, white icon — profile cover). The 36 pt styles keep a 44 pt hit area
 * through the pseudo-element, like the small Button. `size="large"` makes the
 * Muted style 48 (the Message button beside a Large Primary in a bottom bar).
 */
export type IconButtonStyle = 'ghost' | 'muted' | 'tonal' | 'glass'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon buttons never carry visible text. */
  label: string
  variant?: IconButtonStyle
  /** Icon colour: ink (default) or brand (nav-bar back chevron). Tonal is always brand. */
  tone?: 'ink' | 'brand'
  /** Muted only: 'large' = 48 (bottom action bars). */
  size?: 'default' | 'large'
}

const STYLES: Record<IconButtonStyle, string> = {
  ghost: 'h-11 w-11 active:bg-surface-muted',
  muted: "relative h-9 w-9 bg-surface-muted before:absolute before:-inset-1 before:content-[''] active:bg-surface-muted-pressed",
  tonal: "relative h-9 w-9 bg-hockia-soft before:absolute before:-inset-1 before:content-[''] active:bg-surface-muted-pressed",
  glass: "relative h-9 w-9 bg-black/40 backdrop-blur-md before:absolute before:-inset-1 before:content-[''] active:bg-black/55",
}
const MUTED_LARGE = 'h-12 w-12 bg-surface-muted active:bg-surface-muted-pressed'

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', tone = 'ink', size = 'default', className, children, type = 'button', ...rest },
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
      data-size={size === 'large' ? 'large' : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 disabled:opacity-40',
        variant === 'muted' && size === 'large' ? MUTED_LARGE : STYLES[variant],
        variant === 'glass' ? 'text-white' : brand ? 'text-hockia-primary' : 'text-ink-1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
