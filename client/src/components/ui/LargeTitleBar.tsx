import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface LargeTitleBarProps {
  title: string
  /** One trailing 44px action (filters, edit, add) — never more. */
  trailing?: ReactNode
  className?: string
}

/**
 * Tab-root header (Figma 03 Player: Opportunities, Community, Inbox).
 * iOS large title, 34/41 bold with −1.5% tracking, plus at most one action
 * on the right. Mobile only — desktop keeps its wider header (founder
 * ruling 2026-09-19 #4).
 */
export function LargeTitleBar({ title, trailing, className }: LargeTitleBarProps) {
  return (
    <div className={cn('flex items-center justify-between py-1 pl-5 pr-2 lg:hidden', className)}>
      <h1 className="text-large-title text-ink-1">{title}</h1>
      {trailing ? <div className="flex items-center">{trailing}</div> : null}
    </div>
  )
}
