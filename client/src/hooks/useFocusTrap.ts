import { type RefObject, useEffect } from 'react'

interface FocusTrapOptions {
  containerRef: RefObject<HTMLElement | null>
  isActive: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
  ).filter((element) => element.offsetParent !== null || element === document.activeElement)
}

interface TrapEntry {
  container: HTMLElement
  /** Where focus goes when this trap is released while it is on top. */
  restoreTo: HTMLElement | null
}

/**
 * Module-level stack of active traps. Only the top-most entry enforces focus
 * (focus pull-back and Tab wrapping). Without it, two active traps — e.g. the
 * MemberPreviewSheet BottomSheet with the photo MediaLightbox on top — each
 * pulled focus back into themselves on every focus event and ping-ponged
 * `focus()` until the browser threw "Maximum call stack size exceeded"
 * (Sentry JAVASCRIPT-REACT-9B).
 */
const trapStack: TrapEntry[] = []

/** Re-entrancy guard: a focus() issued by a trap must not re-enter a trap. */
let refocusing = false

/**
 * True when `container` is the top-most active focus trap (or no trap is
 * active). Overlays use it to ignore Escape while another overlay sits above
 * them, so one Escape closes one layer.
 */
export function isTopFocusTrap(container: HTMLElement | null): boolean {
  if (trapStack.length === 0) return true
  return container !== null && trapStack[trapStack.length - 1].container === container
}

function focusWithin(container: HTMLElement) {
  const fallback = getFocusableElements(container)[0] ?? container
  refocusing = true
  try {
    fallback.focus({ preventScroll: true })
  } finally {
    refocusing = false
  }
}

/**
 * Traps keyboard focus inside `containerRef` while `isActive`.
 *
 * Nesting: traps form a stack; the most recently activated trap is on top and
 * is the only one that acts. Lower traps stay registered but dormant, and
 * resume when the traps above them are released; focus is restored to the
 * element that was focused when the top trap opened (normally inside the trap
 * beneath). Caveat: effects run child-first, so if a parent and a nested child
 * trap activate in the same commit the parent would be pushed last — we insert
 * a new trap BELOW any active trap whose container it contains to keep the
 * inner one on top. Portaled overlays are not DOM-contained, so for them the
 * activation order decides (in practice they open later, on tap).
 */
export function useFocusTrap({ containerRef, isActive, initialFocusRef }: FocusTrapOptions) {
  useEffect(() => {
    if (!isActive) {
      return
    }

    const container = containerRef.current
    if (!container) {
      return
    }

    const entry: TrapEntry = {
      container,
      restoreTo: document.activeElement as HTMLElement | null,
    }

    // Insert below any already-active trap that lives inside this container
    // (parent/child activated in the same commit); otherwise on top.
    const innerIndex = trapStack.findIndex((e) => e.container !== container && container.contains(e.container))
    if (innerIndex === -1) {
      trapStack.push(entry)
    } else {
      trapStack.splice(innerIndex, 0, entry)
    }
    const isTop = () => trapStack[trapStack.length - 1] === entry

    if (isTop()) {
      const focusableElements = getFocusableElements(container)
      const initialElement = initialFocusRef?.current && container.contains(initialFocusRef.current)
        ? initialFocusRef.current
        : focusableElements[0] ?? container

      // preventScroll so opening a modal never yanks the underlying page —
      // the modal itself is in viewport via fixed positioning.
      refocusing = true
      try {
        initialElement.focus({ preventScroll: true })
      } finally {
        refocusing = false
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) {
        return
      }
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      const focusable = getFocusableElements(container)

      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]
      const current = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (current === firstElement || !container.contains(current)) {
          event.preventDefault()
          lastElement.focus()
        }
      } else if (current === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    const handleFocus = (event: FocusEvent) => {
      if (refocusing || !isTop()) {
        return
      }
      const target = event.target as Node | null
      if (target && container.contains(target)) {
        return
      }
      focusWithin(container)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focus', handleFocus, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focus', handleFocus, true)

      const index = trapStack.indexOf(entry)
      if (index === -1) {
        return
      }
      const wasTop = index === trapStack.length - 1
      trapStack.splice(index, 1)

      if (!wasTop) {
        // A dormant trap closed under an open one. Don't touch focus (the
        // top trap owns it); hand our restore target to the trap directly
        // above if its own target lived inside our (now closing) container.
        const above = trapStack[index]
        if (above && (!above.restoreTo || container.contains(above.restoreTo))) {
          above.restoreTo = entry.restoreTo
        }
        return
      }

      // preventScroll: restoring focus to the element that triggered the
      // modal must not scroll the page — useBodyScrollLock owns scroll
      // position restoration.
      const next = trapStack[trapStack.length - 1]
      const target = entry.restoreTo
      refocusing = true
      try {
        if (next && !(target && target.isConnected && next.container.contains(target))) {
          // The trap beneath resumes: keep focus inside it.
          const fallback = getFocusableElements(next.container)[0] ?? next.container
          fallback.focus({ preventScroll: true })
        } else {
          target?.focus({ preventScroll: true })
        }
      } finally {
        refocusing = false
      }
    }
  }, [containerRef, initialFocusRef, isActive])
}
