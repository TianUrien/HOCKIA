import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { PRESS_SCALE, SPRING, animateSpring, springValue, stopSpring, type SpringValue } from '@/lib/spring'

const CANCEL_DISTANCE = 8

/**
 * Card press (Motion spec row 1): pointerdown scales to 0.96 with response
 * 0.28 · damping 0.90; release springs back to 1 with 0.45 · 0.62 (a small
 * overshoot). Moving more than 8 pt cancels the press so the list scrolls.
 * Replaces CSS `active:scale` on Opportunities cards only (spec note).
 */
export function usePressSpring<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const spring = useRef<SpringValue | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const get = useCallback((): SpringValue => {
    if (!spring.current) {
      spring.current = springValue(1, (x) => {
        const el = ref.current
        if (el) el.style.transform = x === 1 ? '' : `scale(${x.toFixed(4)})`
      })
    }
    return spring.current
  }, [])

  useEffect(() => () => { if (spring.current) stopSpring(spring.current) }, [])

  const release = useCallback(() => {
    start.current = null
    animateSpring(get(), 1, SPRING.release)
  }, [get])

  const onPointerDown = useCallback((e: ReactPointerEvent<T>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY }
    animateSpring(get(), PRESS_SCALE, SPRING.press)
  }, [get])

  const onPointerMove = useCallback((e: ReactPointerEvent<T>) => {
    const s = start.current
    if (!s) return
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > CANCEL_DISTANCE) release()
  }, [release])

  return useMemo(() => ({
    ref,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release, onPointerLeave: release },
  }), [onPointerDown, onPointerMove, release])
}
