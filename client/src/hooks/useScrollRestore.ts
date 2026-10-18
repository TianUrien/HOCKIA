import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** In-memory map — fast writes on scroll, survives within a single SPA session */
const SCROLL_POSITIONS = new Map<string, number>()
/** The entry being restored: its own scroll events are not saved meanwhile. */
let restoringKey: string | null = null

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

    // Only while this entry is still the current one: after a navigation the
    // next page renders BEFORE this effect is cleaned up, and the scroll
    // events of that switch (iOS WebView, 17 Oct 2026) were being saved under
    // the page we just left — Back then landed ~234 px off.
    const isCurrent = () => ((window.history.state as { key?: string } | null)?.key ?? 'default') === key
    const handleScroll = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        if (isCurrent() && restoringKey !== key) SCROLL_POSITIONS.set(key, window.scrollY)
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      cancelAnimationFrame(rafId)
      // No "final save" here: this cleanup runs after the NEXT route has
      // rendered, so window.scrollY already belongs to the new page (device
      // lab 17 Oct 2026: Android Home saved 80 instead of 1249, iOS a wrong
      // offset too, so Back from a role never restored Home). The scroll
      // listener above has already stored the last real position.
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

    // The DOM may not be tall enough yet: lists re-render from cache or
    // re-fetch after a back navigation, and in the native WebViews that can
    // take several seconds (device lab 17 Oct 2026: Android Home came back at
    // 80 px instead of 1186 when this gave up after ~3 s). Keep trying until
    // the page can reach the saved offset, for up to 8 s; the moment the
    // person touches, wheels or presses a key we stop, so we never fight them.
    const deadline = Date.now() + 8000
    let timerId: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const stop = () => { stopped = true; if (timerId !== undefined) clearTimeout(timerId) }
    const userEvents: (keyof WindowEventMap)[] = ['touchstart', 'wheel', 'keydown', 'mousedown']
    userEvents.forEach((ev) => window.addEventListener(ev, stop, { passive: true, once: true }))

    // While restoring, scroll anchoring must not "compensate" for sections
    // above that re-render after Back (it shifted Home by a stable 234 px on
    // iOS and Android, 17 Oct 2026). Once the page is back to its full height
    // the saved offset shows the same content, so we pin to it until the
    // height has been stable for 600 ms (or the person takes over).
    const root = document.documentElement
    const prevAnchor = root.style.overflowAnchor
    root.style.overflowAnchor = 'none'
    let firstOk = 0
    const key = location.key
    restoringKey = key
    const release = () => { root.style.overflowAnchor = prevAnchor; if (restoringKey === key) restoringKey = null }

    const attemptScroll = () => {
      if (stopped) { release(); return }
      const canScroll = root.scrollHeight >= savedY + window.innerHeight * 0.5
      const late = Date.now() >= deadline
      if (canScroll || late) {
        // behavior: 'instant' overrides `scroll-smooth` on <html>. Without
        // it the user sees the page animate back to position on every
        // browser back/forward — same flash as the modal-close case.
        if (Math.abs(window.scrollY - savedY) > 1) window.scrollTo({ top: savedY, left: 0, behavior: 'instant' })
        hasRestoredRef.current = true
        if (!firstOk) firstOk = Date.now()
        // Sections above can still re-render a beat later (Android WebView
        // grew the page 234 px ~500 ms after the first restore): keep the
        // saved offset pinned for 2.5 s unless the person takes over.
        if (late || Date.now() - firstOk >= 2500) { stop(); release(); return }
      }
      timerId = setTimeout(attemptScroll, 100)
    }

    // Use rAF to ensure DOM has processed current renders before checking height
    const rafId = requestAnimationFrame(() => attemptScroll())

    return () => {
      cancelAnimationFrame(rafId)
      stop()
      release()
      userEvents.forEach((ev) => window.removeEventListener(ev, stop))
    }
  }, [navigationType, location.key, ready])
}
