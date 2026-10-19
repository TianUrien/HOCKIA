import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GLASS } from '@/lib/communityCard'
import { useSquircle } from '@/lib/squircle'
import { cn } from '@/lib/utils'

/**
 * Home v1 building blocks (Figma t24oVt… page 02, spec 65:329 "Sizing" +
 * "Finish"): media chips on dark glass, section headers with "See all", the
 * 8 pt grey band between feed items, and the 24 pt continuous-corner card.
 */

/** HIGHLIGHT · FULL MATCH · 0:42 · 1/8 · OPEN ROLE — 12 semibold on dark glass. */
export function GlassChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('pointer-events-none inline-flex items-center rounded-full bg-black/40 px-2.5 py-[5px] text-caption font-semibold tabular-nums text-white', GLASS, className)}>
      {children}
    </span>
  )
}

/** "New in the community ……… See all" (16 semibold + 13 brand). */
export function SectionHeader({ title, action, to, onAction, onLinkClick, className }: { title: string; action?: string; to?: string; onAction?: () => void; /** Fired alongside the Link navigation (module click tracking). */ onLinkClick?: () => void; className?: string }) {
  const actionCls = 'flex min-h-[44px] items-center pl-3 text-secondary font-semibold text-hockia-primary'
  return (
    <div className={cn('flex items-center px-4', className)}>
      <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-[21px] text-ink-1">{title}</h2>
      {action && to && <Link to={to} onClick={onLinkClick} className={actionCls}>{action}</Link>}
      {action && !to && onAction && <button type="button" onClick={onAction} className={actionCls}>{action}</button>}
    </div>
  )
}

/** The 8 pt band between feed items (surface/subtle). */
export function FeedBand() {
  return <div aria-hidden="true" className="h-2 bg-surface-subtle" />
}

/** A card with 24 pt continuous corners (60 % smoothing), radius kept as fallback. */
export function SquircleBox({ radius = 24, className, children, style }: { radius?: number; className?: string; children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  useSquircle(ref, radius)
  return (
    <div ref={ref} className={className} style={{ borderRadius: radius, ...style }}>
      {children}
    </div>
  )
}
