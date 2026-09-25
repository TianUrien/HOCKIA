import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  ariaLabel: string
  children: ReactNode
  className?: string
}

/**
 * Half-sheet from the bottom (Figma "sheet": 22px top radius, grab handle,
 * scrim). Used by Share, Apply, Filters and Member preview. Full width on
 * phones; on wider screens it floats centred with the same shape so desktop
 * keeps one visual language.
 */
export function BottomSheet({ open, onClose, ariaLabel, children, className }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: panelRef, isActive: open })
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return
    // Lets other floating UI (SettingsSheet, popovers) close themselves.
    document.dispatchEvent(new Event('hockia:overlay-opened'))
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Another overlay (lightbox, sign-in sheet) is open on top: its own
      // Escape closes it; this sheet stays.
      if (!isTopFocusTrap(panelRef.current)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[88dvh] w-full flex-col rounded-t-sheet bg-white pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-[0_-8px_30px_rgba(0,0,0,0.12)] focus:outline-none sm:max-w-md sm:rounded-sheet sm:pb-2',
          className,
        )}
      >
        <div className="flex justify-center pb-1 pt-2" aria-hidden="true">
          <span className="h-[5px] w-9 rounded-full bg-ink-4" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
