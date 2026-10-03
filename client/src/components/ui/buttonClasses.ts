import { cn } from '@/lib/utils'

/**
 * Class composition for the shared Button (Figma "Button" 459:146). Lives
 * apart from `Button.tsx` so the component file exports only components
 * (fast refresh) and so a crawlable navigation CTA that must stay an
 * `<a>`/`<Link>` (cmd/middle-click, SEO) can look exactly like the Button.
 */
export type ButtonStyle = 'primary' | 'tonal' | 'secondary' | 'tertiary' | 'link' | 'destructive' | 'danger'
export type ButtonSize = 'large' | 'small'

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
  large: 'h-12 px-5 text-body font-semibold',
  // 36 pt visual, 44 pt hit area via the pseudo-element.
  small: "relative h-9 px-3.5 text-row font-semibold before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
}

/** App radius per size. */
const RADIUS: Record<ButtonSize, string> = {
  large: 'rounded-[12px]',
  small: 'rounded-[10px]',
}

export interface ButtonClassOptions {
  variant?: ButtonStyle
  size?: ButtonSize
  block?: boolean
  /**
   * Radius class override. The web landing (Figma "Web A v2") draws its
   * buttons at radius 16 while the app keeps 12/10; `cn` is plain clsx, so
   * a conflicting `rounded-*` in `className` would not reliably win.
   */
  radius?: string
  className?: string
}

export function buttonClassName({ variant = 'primary', size = 'large', block = false, radius, className }: ButtonClassOptions = {}): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 disabled:opacity-40',
    STYLES[variant],
    SIZES[size],
    radius ?? RADIUS[size],
    block && 'w-full',
    className,
  )
}
