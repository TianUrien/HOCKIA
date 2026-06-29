import { type ReactNode, type MouseEvent, type KeyboardEvent, type PointerEvent, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * DashboardCard — base wrapper for every card in the Dashboard Bento Grid.
 * White background, rounded-2xl, soft border, hover lift.
 *
 * Layout slots (top to bottom):
 *   - icon tile (purple-50 background, purple-600 icon)
 *   - title + optional completion line
 *   - children (whatever the card wants to show)
 *   - optional CTA row that navigates to the section's dedicated route
 *
 * Whole-card tap (Apple-style): when BOTH `onCtaClick` and `ctaLabel` are set the
 * ENTIRE card is tappable and activates the same navigation as the CTA — users
 * tested naturally tapping the card body, not just the small link. The CTA stays
 * visible as the affordance. A tap that lands on a self-handled element is left to
 * that element, so nested actions keep working: genuine inner controls
 * (buttons/links/inputs) AND transient overlays rendered inside the body (an open
 * tooltip / dialog / menu — passive divs that must not trigger navigation). A card
 * with no CTA label (e.g. an empty visitor media card) stays non-interactive — no
 * affordance, no navigation. The press feedback only fires for genuine card-body
 * taps, not when an inner control is pressed.
 */
interface DashboardCardProps {
  /** Icon component (lucide). Rendered in the small purple tile. */
  icon: React.ComponentType<{ className?: string }>
  /** Card title, e.g. "Basic Information". */
  title: string
  /** Optional summary line beneath the title — count, label, percent, etc. */
  subtitle?: ReactNode
  /** Card body. */
  children?: ReactNode
  /** Optional CTA at the bottom-left of the card. Its presence (with onCtaClick)
   *  also makes the whole card tappable. */
  ctaLabel?: string
  /** Called when the CTA — or anywhere on the card body — is activated. */
  onCtaClick?: () => void
  /** Optional extra class on the outer card wrapper. */
  className?: string
  /** Optional test id passed through for e2e + unit tests. */
  testId?: string
  /** Make the card span the full grid width (used for Hero). */
  fullWidth?: boolean
}

// A tap landing on one of these inside the card is "self-handled" and must NOT
// trigger card navigation: genuine inner controls, plus transient overlay surfaces
// (an open tooltip/dialog/menu/listbox is a passive layer, not the card body).
const SELF_HANDLED_SELECTOR =
  'a, button, input, select, textarea, label, ' +
  '[role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="menuitem"], ' +
  '[role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"]'

export default function DashboardCard({
  icon: Icon,
  title,
  subtitle,
  children,
  ctaLabel,
  onCtaClick,
  className,
  testId,
  fullWidth = false,
}: DashboardCardProps) {
  // No CTA label => no visible affordance => not tappable (don't navigate from a
  // card that gives the user no cue it's a link).
  const interactive = Boolean(onCtaClick && ctaLabel)
  const [pressed, setPressed] = useState(false)

  // The card itself carries role="button", so closest() also matches the card;
  // a self-handled match must be a GENUINE descendant (not the card itself).
  const selfHandledTarget = (e: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    const hit = (e.target as HTMLElement | null)?.closest(SELF_HANDLED_SELECTOR)
    return hit && hit !== e.currentTarget ? hit : null
  }

  const handleCardClick = (e: MouseEvent<HTMLElement>) => {
    if (!onCtaClick) return
    if (selfHandledTarget(e)) return // inner control / overlay handles its own tap
    onCtaClick()
  }

  const handleCardKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Only when the card itself is focused — never swallow keys meant for an
    // inner control.
    if (!onCtaClick || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCtaClick()
    }
  }

  // Press feedback (scale) only when the card BODY is pressed — not when an inner
  // button/toggle/overlay is pressed (that control gives its own feedback).
  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!selfHandledTarget(e)) setPressed(true)
  }
  const clearPressed = () => setPressed(false)

  const interactiveProps = interactive
    ? {
        onClick: handleCardClick,
        onKeyDown: handleCardKeyDown,
        onPointerDown: handlePointerDown,
        onPointerUp: clearPressed,
        onPointerCancel: clearPressed,
        onPointerLeave: clearPressed,
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': `${title} — ${ctaLabel}`,
      }
    : {}

  return (
    <section
      data-testid={testId}
      {...interactiveProps}
      className={cn(
        'group flex flex-col bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6',
        'transition-all duration-150',
        interactive
          ? 'cursor-pointer hover:shadow-md hover:border-gray-300 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40 focus-visible:ring-offset-2'
          : 'hover:shadow-md',
        pressed && 'scale-[0.98]',
        fullWidth && 'md:col-span-2',
        className,
      )}
    >
      <header className="flex items-start gap-3 mb-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#8026FA]/10">
          <Icon className="h-5 w-5 text-[#8026FA]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {subtitle && (
            <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
          )}
        </div>
      </header>

      <div className="flex-1">{children}</div>

      {ctaLabel && onCtaClick && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onCtaClick}
            // The whole card is the primary tap target; this stays as the visible
            // affordance and animates on card hover. tabIndex=-1 so keyboard users
            // get a single stop (the card) rather than a redundant one.
            tabIndex={-1}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#8026FA] transition-colors group-hover:text-[#6B20D4]"
          >
            {ctaLabel}
            <ChevronRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </section>
  )
}
