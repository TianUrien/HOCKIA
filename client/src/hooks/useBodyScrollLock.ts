import { useLayoutEffect } from 'react'

/**
 * Locks the document scroll so that only in-app scroll containers can move.
 * Essential for immersive surfaces like chat where the browser viewport
 * should remain visually stable during keyboard animations.
 */
export function useBodyScrollLock(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const body = document.body
    const previousHtmlOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyWidth = body.style.width
    const previousBodyTop = body.style.top
    const scrollY = window.scrollY

    root.setAttribute('data-chat-scroll-lock', 'true')
    body.setAttribute('data-chat-scroll-lock', 'true')

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.width = '100%'
    body.style.top = `-${scrollY}px`

    return () => {
      root.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      body.style.position = previousBodyPosition
      body.style.width = previousBodyWidth
      body.style.top = previousBodyTop
      root.removeAttribute('data-chat-scroll-lock')
      body.removeAttribute('data-chat-scroll-lock')
      if (typeof window.scrollTo === 'function') {
        // behavior: 'instant' overrides the global `scroll-smooth` set
        // on <html> (globals.css). Without it, the cleanup's restore
        // animates over ~300ms and the user sees the page "scroll back"
        // after closing the modal. We want this single paint, invisible.
        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' })
      }
    }
  }, [enabled])
}
