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

/* ────────────────────────── Web (landing + auth) ──────────────────────────
 * Figma "Web v3 / Button" (122:1982) and "Web v3 / Button on dark" (141:534),
 * approved 6 Oct 2026. The app button above cannot express these: the web
 * sizes are Large 52 / Medium 40 pills with a hover lift + glow, a pressed
 * scale and a two-ring focus (2 px white gap + 4 px focus ring). They share
 * nothing but the base layout classes, so they live beside it rather than as
 * more options on `buttonClassName`.
 */
export type WebButtonStyle =
  | 'primary'
  | 'secondary'
  | 'link'
  /** On the dark closing panel: white fill, brand label. */
  | 'onDarkPrimary'
  /** On the dark closing panel: outlined, white label. */
  | 'onDarkSecondary'
export type WebButtonSize = 'large' | 'medium'

const WEB_BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full transition-[background-color,box-shadow,transform,border-color,color] duration-[160ms] ease-out focus:outline-none motion-reduce:transition-none motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-40'

const WEB_STYLES: Record<WebButtonStyle, string> = {
  primary:
    'bg-brand-primary text-white hover:-translate-y-px hover:bg-brand-primary-hover hover:shadow-[0_8px_20px_rgba(108,43,217,0.32)] active:translate-y-0 active:scale-[0.98] active:bg-brand-primary-pressed active:shadow-none focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
  secondary:
    'border-[1.5px] border-line-strong bg-white text-ink-1 hover:bg-surface-subtle active:bg-surface-muted focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
  link:
    'group gap-1 rounded-lg px-0 text-brand-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring',
  onDarkPrimary:
    'bg-white text-brand-primary hover:bg-brand-soft hover:shadow-[0_8px_24px_rgba(255,255,255,0.25)] active:scale-[0.98] active:bg-brand-soft-hover active:shadow-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a0a45]',
  onDarkSecondary:
    'border-[1.5px] border-white/35 bg-transparent text-white hover:border-white/60 hover:bg-white/10 active:bg-white/15 focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a0a45]',
}

const WEB_SIZES: Record<WebButtonSize, string> = {
  large: 'h-[52px] px-7 text-[17px] font-semibold leading-[22px]',
  medium: 'h-10 px-[18px] text-[14px] font-semibold leading-5',
}

/** Link buttons keep the label size of their row but no pill box. */
const WEB_LINK_SIZES: Record<WebButtonSize, string> = {
  large: 'h-[52px] text-[17px] font-semibold leading-[22px]',
  medium: 'h-10 text-[14px] font-semibold leading-5',
}

export interface WebButtonClassOptions {
  variant?: WebButtonStyle
  size?: WebButtonSize
  block?: boolean
  className?: string
}

export function webButtonClassName({ variant = 'primary', size = 'large', block = false, className }: WebButtonClassOptions = {}): string {
  return cn(
    WEB_BASE,
    WEB_STYLES[variant],
    variant === 'link' ? WEB_LINK_SIZES[size] : WEB_SIZES[size],
    block && 'w-full',
    className,
  )
}

/** The chevron that follows a web Link button: nudges 2 px right on hover. */
export const WEB_LINK_CHEVRON = 'h-4 w-4 shrink-0 transition-transform duration-[160ms] group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none'
