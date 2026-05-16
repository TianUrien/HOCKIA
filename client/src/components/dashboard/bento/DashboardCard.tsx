import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * DashboardCard — base wrapper for every card in the Player Dashboard
 * Bento Grid. White background, rounded-2xl, soft border, hover lift.
 *
 * Layout slots (top to bottom):
 *   - icon tile (purple-50 background, purple-600 icon)
 *   - title + optional completion line
 *   - children (whatever the card wants to show)
 *   - optional CTA row that links to the legacy tab via ?tab=
 *
 * The CTA is a plain anchor-styled button so the card itself stays a
 * div (no nested-interactive issues); the surrounding card is NOT
 * clickable as a whole. Recruiters and owners interact with specific
 * counts and CTAs inside cards, not whole-card taps.
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
  /** Optional CTA at the bottom-left of the card. */
  ctaLabel?: string
  /** Called when the CTA is clicked. */
  onCtaClick?: () => void
  /** Optional extra class on the outer card wrapper. */
  className?: string
  /** Optional test id passed through for e2e + unit tests. */
  testId?: string
  /** Make the card span the full grid width (used for Hero). */
  fullWidth?: boolean
}

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
  return (
    <section
      data-testid={testId}
      className={cn(
        'flex flex-col bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6',
        'transition-shadow hover:shadow-md',
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
            className="inline-flex items-center gap-1 text-sm font-medium text-[#8026FA] hover:text-[#6B20D4] transition-colors"
          >
            {ctaLabel}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  )
}
