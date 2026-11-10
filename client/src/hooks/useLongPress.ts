import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

const MOVE_TOLERANCE = 8

/**
 * Press and hold (iOS context-menu gesture) for touch, plus right-click on
 * desktop. Fires after `delay` ms unless the finger moves more than 8 pt
 * (the list scrolls instead) or lifts. The click that follows a long press is
 * swallowed so the row or bubble does not also open.
 */
export function useLongPress(onLongPress: (() => void) | null, delay = 450) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  // A long press (or right-click) just opened the menu: swallow the click
  // that follows. `touchFired` marks the touch timer, so the contextmenu iOS
  // may also send for the same hold doesn't open the menu twice.
  const fired = useRef(false)
  const touchFired = useRef(false)
  const callback = useRef(onLongPress)
  useEffect(() => { callback.current = onLongPress }, [onLongPress])

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  useEffect(() => clear, [clear])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    // Every new press starts a new gesture (a right-click leaves no click
    // behind to reset these).
    fired.current = false
    touchFired.current = false
    if (!callback.current) return
    // Desktop uses right-click (onContextMenu); a mouse hold stays a click.
    if (e.pointerType === 'mouse') return
    origin.current = { x: e.clientX, y: e.clientY }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      fired.current = true
      touchFired.current = true
      callback.current?.()
    }, delay)
  }, [delay])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const o = origin.current
    if (!o) return
    if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) clear()
  }, [clear])

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (!callback.current) return
    e.preventDefault()
    // Touch: the timer already handled this hold (iOS may also send contextmenu).
    if (touchFired.current) return
    clear()
    fired.current = true
    callback.current()
  }, [clear])

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return
    fired.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return useMemo(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu,
    onClickCapture,
  }), [clear, onClickCapture, onContextMenu, onPointerDown, onPointerMove])
}
