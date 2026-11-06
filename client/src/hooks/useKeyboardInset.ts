import { useEffect, useState } from 'react'
import { KEYBOARD_MIN_PX } from '@/hooks/useSafeArea'

export interface KeyboardInset {
  /** Keyboard height in px: lift bottom-anchored UI by this much. 0 when no keyboard. */
  inset: number
  /** Height of what's visible above the keyboard (iOS may also pan the page). 0 when no keyboard. */
  visible: number
}

const NONE: KeyboardInset = { inset: 0, visible: 0 }

/**
 * The on-screen keyboard while `active`. Same VisualViewport measure as
 * useSafeArea, but local state instead of global CSS variables, so a sheet
 * can use it while the chat owns those variables. iOS overlays the keyboard
 * on the layout viewport, so anything fixed to the bottom (a sheet with a
 * text field) must lift itself by `inset` and fit in `visible`.
 */
export function useKeyboardInset(active: boolean): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>(NONE)
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!active || !viewport) { setState(NONE); return }
    const update = () => {
      const raw = window.innerHeight - viewport.height - Math.max(0, viewport.offsetTop)
      const next = raw > KEYBOARD_MIN_PX ? { inset: Math.round(raw), visible: Math.round(viewport.height) } : NONE
      setState((prev) => (prev.inset === next.inset && prev.visible === next.visible ? prev : next))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [active])
  return state
}

const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, [contenteditable="true"]'

/**
 * Safety net, mounted once in App: when a focused field ends up under the
 * on-screen keyboard (iOS doesn't always pan to fields inside fixed modals),
 * scroll it to the middle of what's visible. A field already in view, like
 * the chat composer the chat lifts itself, is left alone.
 */
export function useRevealFocusedField(): void {
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!viewport) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFocus = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof HTMLElement) || !el.matches(EDITABLE)) return
      clearTimeout(timer)
      // Wait for the keyboard animation, then measure.
      timer = setTimeout(() => {
        if (document.activeElement !== el) return
        const visibleBottom = viewport.offsetTop + viewport.height
        const { top, bottom } = el.getBoundingClientRect()
        if (bottom > visibleBottom - 8 || top < viewport.offsetTop) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 350)
    }
    document.addEventListener('focusin', onFocus)
    return () => { clearTimeout(timer); document.removeEventListener('focusin', onFocus) }
  }, [])
}
