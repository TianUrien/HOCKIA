import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** In-memory map — fast writes on scroll, survives within a single SPA session */
const SCROLL_POSITIONS = new Map<string, number>()

/**
 * Saves scroll position on scroll events and restores it on POP (back/forward) navigation.
 *
 * @param ready - Pass `false` while data is loading so restoration waits for the DOM to be tall enough.
 *                Defaults to `true` (restore immediately).
 */
export function useScrollRestore(ready = true) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const hasRestoredRef = useRef(false)

  // Reset restoration flag when the location changes
  useEffect(() => {
    hasRestoredRef.current = false
  }, [location.key])

  // Save scroll position on scroll (debounced via rAF)
  useEffect(() => {
    const key = location.key
    let rafId: number

    const handleScroll = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        SCROLL_POSITIONS.set(key, window.scrollY)
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      cancelAnimationFrame(rafId)
      // Final save on unmount
      SCROLL_POSITIONS.set(key, window.scrollY)
    }
  }, [location.key])

  // Restore scroll position on POP navigation when ready
  useEffect(() => {
    if (navigationType !== 'POP' || hasRestoredRef.current) return
    if (!ready) return

    const savedY = SCROLL_POSITIONS.get(location.key)
    if (savedY == null || savedY === 0) {
      hasRestoredRef.current = true
      return
    }

    // Retry until the document is tall enough to scroll to the saved position
    const attemptScroll = (attempts = 0) => {
      const canScroll = document.documentElement.scrollHeight >= savedY + window.innerHeight * 0.5
      if (canScroll || attempts >= 10) {
        // behavior: 'instant' overrides `scroll-smooth` on <html>. Without
        // it the user sees the page animate back to position on every
        // browser back/forward — same flash as the modal-close case.
        window.scrollTo({ top: savedY, left: 0, behavior: 'instant' })
        hasRestoredRef.current = true
      } else {
        setTimeout(() => attemptScroll(attempts + 1), 50)
      }
    }

    requestAnimationFrame(() => attemptScroll())
  }, [navigationType, location.key, ready])
}
