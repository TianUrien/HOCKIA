import type { ReactNode } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { cn } from '@/lib/utils'

export interface ActionSheetItem {
  key: string
  label: string
  icon?: ReactNode
  tone?: 'default' | 'danger'
  onSelect: () => void
  testId?: string
}

interface ActionSheetProps {
  open: boolean
  onClose: () => void
  /** Who or what the actions are about ("Message from Ana", a name). */
  title?: string
  /** A short preview line under the title (the message text). */
  subtitle?: string
  items: ActionSheetItem[]
  testId?: string
}

/**
 * The press-and-hold menu (iOS context-menu equivalent) as a sheet: one row
 * per action, 52 pt tall, danger rows in red, Cancel at the bottom. Choosing
 * an action closes the sheet first, then runs it.
 */
export function ActionSheet({ open, onClose, title, subtitle, items, testId }: ActionSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title ?? 'Actions'} initialFocus="panel">
      <div className="px-4 pb-2" data-testid={testId}>
        {(title || subtitle) && (
          <div className="px-1 pb-3 pt-1 text-center">
            {title && <p className="truncate text-[15px] font-semibold text-ink-1">{title}</p>}
            {subtitle && <p className="mt-0.5 line-clamp-2 text-secondary text-ink-2">{subtitle}</p>}
          </div>
        )}
        <ul className="overflow-hidden rounded-[14px] bg-surface-grouped">
          {items.map((item, index) => (
            <li key={item.key} className={cn(index > 0 && 'border-t border-line')}>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  item.onSelect()
                }}
                className={cn(
                  'flex h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] font-medium active:bg-surface-muted',
                  item.tone === 'danger' ? 'text-status-danger' : 'text-ink-1',
                )}
                data-testid={item.testId}
              >
                {item.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-surface-grouped text-[16px] font-semibold text-ink-1 active:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  )
}
