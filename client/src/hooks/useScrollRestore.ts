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

    // For list views with pagination/lazy loading, the DOM might not be tall
    // enough immediately. We retry with exponential backoff up to 1 second,
    // then scroll anyway to avoid losing the position forever.
    let attempts = 0
    const maxAttempts = 20 // ~1 second with 50ms backoff
    let delayMs = 50
    // Track the in-flight rAF / timeout so the cleanup can cancel them. Without
    // this, a POP into a slow/paginating list leaves a chain of timers running
    // (up to ~1s); navigating away again before it settles would let an
    // orphaned timer fire window.scrollTo on the NEW view — hijacking its
    // scroll position. Cancelling on unmount / key change prevents that.
    let timerId: ReturnType<typeof setTimeout> | undefined

    const attemptScroll = () => {
      const canScroll = document.documentElement.scrollHeight >= savedY + window.innerHeight * 0.5
      if (canScroll) {
        // behavior: 'instant' overrides `scroll-smooth` on <html>. Without
        // it the user sees the page animate back to position on every
        // browser back/forward — same flash as the modal-close case.
        window.scrollTo({ top: savedY, left: 0, behavior: 'instant' })
        hasRestoredRef.current = true
        return
      }

      attempts += 1
      if (attempts >= maxAttempts) {
        // Max retries reached — scroll anyway. This handles cases where the
        // list is still paginating (DOM grows as user scrolls). Scrolling
        // positions the user back in the right zone even if the exact
        // scroll-to-content isn't available yet.
        window.scrollTo({ top: savedY, left: 0, behavior: 'instant' })
        hasRestoredRef.current = true
        return
      }

      // Exponential backoff: 50ms, 100ms, 150ms... prevents thrashing
      // on rapidly-growing DOM while giving it enough time to render.
      delayMs = Math.min(delayMs + 50, 200)
      timerId = setTimeout(attemptScroll, delayMs)
    }

    // Use rAF to ensure DOM has processed current renders before checking height
    const rafId = requestAnimationFrame(() => attemptScroll())

    return () => {
      cancelAnimationFrame(rafId)
      if (timerId !== undefined) clearTimeout(timerId)
    }
  }, [navigationType, location.key, ready])
}
