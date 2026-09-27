import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

export interface MoreMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

interface MoreMenuProps {
  items: MoreMenuItem[]
  /** Accessible name for the trigger. */
  label?: string
  /** Optional line above the items in the phone sheet (e.g. the person's name). */
  title?: string
  /** Trigger styling for the host (glass circle on a cover, plain in a nav bar). */
  triggerClassName?: string
  iconClassName?: string
  testId?: string
}

const MENU_WIDTH = 208
const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 6

/**
 * The "…" menu, top right (Figma: header with "…"). Phones get the action
 * sheet (same look as the club's role actions); wider screens a popover
 * anchored to the button. Items run in the order given — Report sits in the
 * same place on every surface because callers add it last-but-block.
 */
export function MoreMenu({ items, label = 'More actions', title, triggerClassName, iconClassName, testId = 'more-menu' }: MoreMenuProps) {
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.right - MENU_WIDTH, maxLeft))
    setPos({ top: rect.bottom + ANCHOR_GAP, left })
  }, [])

  useLayoutEffect(() => {
    if (open && !isPhone) measure()
    else setPos(null)
  }, [open, isPhone, measure])

  useEffect(() => {
    if (!open || isPhone) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onMove = () => measure()
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, isPhone, measure])

  if (items.length === 0) return null

  const select = (item: MoreMenuItem) => {
    setOpen(false)
    item.onSelect()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label={label}
        aria-haspopup={isPhone ? 'dialog' : 'menu'}
        aria-expanded={open ? 'true' : 'false'}
        data-testid={testId}
        className={triggerClassName ?? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-gray-100'}
      >
        <MoreHorizontal className={iconClassName ?? 'h-5 w-5'} strokeWidth={2} />
      </button>

      {isPhone ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel={title ?? label}>
          <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1" data-testid={`${testId}-sheet`}>
            {title && <p className="truncate pb-3 text-center text-secondary font-semibold text-ink-2">{title}</p>}
            <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => select(item)}
                  className={cn('flex h-[52px] w-full items-center gap-3 px-4 text-left text-body disabled:opacity-50', item.destructive ? 'text-hockia-danger' : 'text-ink-1')}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setOpen(false)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body text-ink-2">Cancel</button>
          </div>
        </BottomSheet>
      ) : (
        open && pos && createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-[9999] rounded-xl border border-line bg-white py-1 shadow-lg animate-fade-in"
            data-testid={`${testId}-popover`}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => select(item)}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 disabled:opacity-50', item.destructive ? 'text-hockia-danger' : 'text-ink-1')}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      )}
    </>
  )
}
