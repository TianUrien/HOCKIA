import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon buttons never carry visible text. */
  label: string
}

/** 44×44 round tap target for a 24px icon (Figma "icon button/…"). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-1 transition-colors active:bg-surface-muted disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
