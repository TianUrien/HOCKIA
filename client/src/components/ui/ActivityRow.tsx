import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * List item / Activity (Figma 531:469) for lists outside Pulse — the same
 * anatomy as the "What happened" rows (components/pulse/WhatHappened): a
 * 40 px leading visual (an avatar, or `ActivityIconCircle` for a system
 * event with no actor), the sentence in ink-1 16/22, the time under it in
 * ink-3 13, 16 px side padding. The trailing ink-4 chevron shows ONLY when
 * the row has a destination (`onOpen`); a row without one is plain and not
 * tappable. Everything is grey: an activity line never asks for amber.
 *
 * `unread` adds the brand-purple dot (never a number). `children` sit under
 * the time (inline answers such as Accept / Decline).
 */
interface ActivityRowProps {
  leading: ReactNode
  text: ReactNode
  /** Optional second line (ink-2 13): what the sentence refers to. */
  detail?: ReactNode
  when: string
  /** Opens the row's destination. Omit for a row that leads nowhere. */
  onOpen?: () => void
  unread?: boolean
  children?: ReactNode
  className?: string
}

export function ActivityRow({ leading, text, detail, when, onOpen, unread = false, children, className }: ActivityRowProps) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen()
              }
            }
          : undefined
      }
      className={cn('group flex items-start gap-3 pl-4 text-left', onOpen && 'cursor-pointer transition-colors active:bg-surface-muted', className)}
      data-testid={onOpen ? 'activity-row-link' : 'activity-row-plain'}
    >
      <span className="shrink-0 py-3.5">{leading}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 border-b border-line py-3.5 pr-4 group-[.is-last]:border-b-0">
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[16px] leading-[22px] text-ink-1', unread && 'font-semibold')} data-testid="activity-row-text">{text}</span>
          {detail ? <span className="block text-secondary text-ink-2">{detail}</span> : null}
          <span className="mt-0.5 block text-secondary text-ink-3" data-testid="activity-row-when">{when}</span>
          {children}
        </span>
        {unread && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-hockia-primary" data-testid="activity-row-unread" />}
        {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" data-testid="activity-row-chevron" />}
      </span>
    </div>
  )
}

/** Leading visual for a system event with no actor: brand-soft circle, brand icon. */
export function ActivityIconCircle({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary" aria-hidden="true" data-testid="activity-row-icon">
      <Icon className="h-5 w-5" strokeWidth={1.75} />
    </span>
  )
}
