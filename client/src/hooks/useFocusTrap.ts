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

export function useFocusTrap({ containerRef, isActive, initialFocusRef }: FocusTrapOptions) {
  useEffect(() => {
    if (!isActive) {
      return
    }

    const container = containerRef.current
    if (!container) {
      return
    }

    const previouslyFocusedElement = document.activeElement as HTMLElement | null
    const focusableElements = getFocusableElements(container)
    const initialElement = initialFocusRef?.current && container.contains(initialFocusRef.current)
      ? initialFocusRef.current
      : focusableElements[0] ?? container

    // Ensure the container can receive focus if needed. preventScroll
    // so opening a modal never yanks the underlying page — the modal
    // itself is in viewport via fixed positioning.
    if (initialElement === container && container.tabIndex === -1) {
      container.focus({ preventScroll: true })
    } else {
      initialElement?.focus({ preventScroll: true })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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
      const target = event.target as HTMLElement | null
      if (container.contains(target)) {
        return
      }

      const focusable = getFocusableElements(container)
      const fallback = focusable[0] ?? container
      fallback.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focus', handleFocus, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focus', handleFocus, true)
      // preventScroll: restoring focus to the element that triggered
      // the modal must not scroll the page — useBodyScrollLock owns
      // scroll position restoration. Without this, closing a modal
      // could pull the page to the trigger element's DOM position.
      previouslyFocusedElement?.focus({ preventScroll: true })
    }
  }, [containerRef, initialFocusRef, isActive])
}
