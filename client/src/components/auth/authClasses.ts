/**
 * Landing v3 auth form classes (Figma Log in 127:2141 / Sign up 127:2261,
 * approved 6 Oct 2026). Kept apart from authUi.tsx so that file exports only
 * components (fast refresh).
 */

/** Field label: 14 semibold ink-2. */
export const webFieldLabel = 'block text-[14px] font-semibold leading-5 text-ink-2'

/** Text field: surface-muted, radius 14, 52 tall, no border at rest. The 16 px
 *  value keeps iOS Safari from zooming the page on focus. */
export const webFieldInput =
  'h-[52px] w-full rounded-[14px] bg-surface-muted px-4 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus-ring'

/** The switch line's link ("Create an account" / "Log in"). */
export const switchLink =
  'rounded font-semibold text-brand-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

/** "or" divider between OAuth and the email form. */
export const orDivider = 'relative flex items-center gap-3 text-[13px] leading-[18px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line'
