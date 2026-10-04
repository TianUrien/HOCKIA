import type { ReactNode } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Detail row (Figma "03 · Components" 467:128): a fact in a hairline list.
 * Label in ink-2 on the left; the value semibold and right-aligned, on up to
 * two lines, with an optional secondary second line. `align="start"` is the
 * facts-table form (fixed label column, value reads from the left). With
 * `onClick` the row is a 44 pt button with an ink-4 chevron; `locked` shows
 * a lock instead and the row does nothing.
 */
interface DetailRowItemProps {
  label: string
  value: ReactNode | null
  /** Secondary second line under the value. */
  sub?: ReactNode | null
  /** Shown in ink-3 when there is no value yet. */
  placeholder?: string
  onClick?: () => void
  locked?: boolean
  align?: 'end' | 'start'
  /** Tone of the value (trust facts are gold). */
  tone?: 'default' | 'gold'
  className?: string
}

export function DetailRowItem({ label, value, sub, placeholder, onClick, locked = false, align = 'end', tone = 'default', className }: DetailRowItemProps) {
  const end = align === 'end'
  const body = (
    <>
      <span className={cn('shrink-0 text-row text-ink-2', !end && 'w-[110px]')}>{label}</span>
      <span className={cn('min-w-0 flex-1', end && 'text-right')}>
        <span
          className={cn(
            'line-clamp-2 block break-words text-row',
            end && 'font-semibold',
            tone === 'gold' ? 'font-semibold text-gold' : value ? 'text-ink-1' : 'font-normal text-ink-3',
          )}
          data-testid="detail-row-value"
        >
          {value ?? placeholder}
        </span>
        {sub && <span className="block truncate text-secondary text-ink-2" data-testid="detail-row-sub">{sub}</span>}
      </span>
      {locked ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />
      ) : onClick ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />
      ) : null}
    </>
  )
  const cls = cn('flex min-h-[48px] w-full items-center gap-3 py-3 text-left', className)
  return onClick && !locked
    ? <button type="button" onClick={onClick} className={cls} data-testid="detail-row-item">{body}</button>
    : <div className={cls} data-testid="detail-row-item">{body}</div>
}
