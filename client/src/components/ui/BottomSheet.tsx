import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSquircle } from '@/lib/squircle'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { SPRING, animateSpring, springValue, stopSpring } from '@/lib/spring'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  ariaLabel: string
  children: ReactNode
  className?: string
  /** 'panel': focus the sheet itself on open, not its first button — for
   *  sheets that open by themselves (no tap), so no focus ring shows on the
   *  primary action. Keyboard users still Tab straight into it. */
  initialFocus?: 'first' | 'panel'
}

/**
 * Half-sheet from the bottom (Figma "sheet": 28 pt continuous top corners —
 * founder ruling 2026-10-11 — grab handle,
 * scrim). Used by Share, Apply, Filters and Member preview. Full width on
 * phones; on wider screens it floats centred with the same shape so desktop
 * keeps one visual language.
 */
export function BottomSheet({ open, onClose, ariaLabel, children, className, initialFocus = 'first' }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: panelRef, isActive: open, initialFocusRef: initialFocus === 'panel' ? panelRef : undefined })
  useBodyScrollLock(open)
  // Continuous corners: top only on phones, all four where it floats centred.
  const floating = useMediaQuery('(min-width: 640px)')
  // iOS lays the keyboard over the page: lift the sheet so a text field in it stays in view.
  const kb = useKeyboardInset(open)
  useSquircle(panelRef, floating ? 28 : { tl: 28, tr: 28 }, 0.6, open)

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

  // Open with the sheet spring (Motion spec: response 0.48, damping 0.86):
  // the panel rises from below its own height while the scrim fades in.
  // Reduce Motion lands instantly (lib/spring).
  const scrimRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const scrim = scrimRef.current
    if (!panel) return
    const from = panel.getBoundingClientRect().height || 320
    const value = springValue(1, (p) => {
      panel.style.transform = p <= 0.0005 ? '' : `translate3d(0, ${(p * from).toFixed(2)}px, 0)`
      if (scrim) scrim.style.opacity = String(1 - Math.min(1, Math.max(0, p)))
    })
    value.onUpdate(1)
    animateSpring(value, 0, SPRING.sheetOpen)
    return () => {
      stopSpring(value)
      panel.style.transform = ''
      if (scrim) scrim.style.opacity = ''
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center sm:items-center" role="presentation" style={kb.inset ? { paddingBottom: kb.inset } : undefined} data-keyboard-inset={kb.inset || undefined}>
      <div ref={scrimRef} className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        // With the keyboard up: fit what's visible and drop the home-indicator padding.
        style={kb.inset ? { maxHeight: `calc(${kb.visible}px - env(safe-area-inset-top) - 12px)`, paddingBottom: 8 } : undefined}
        className={cn(
          'relative flex max-h-[88dvh] w-full flex-col rounded-t-sheet bg-white pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-[0_-8px_30px_rgba(0,0,0,0.12)] focus:outline-none sm:max-w-md sm:rounded-sheet sm:pb-2',
          className,
        )}
      >
        <div className="flex justify-center pb-1 pt-2" aria-hidden="true">
          {/* No grabber on desktop dialogs (design audit B5). */}
          <span className="h-[5px] w-9 rounded-full bg-ink-4 lg:hidden" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
