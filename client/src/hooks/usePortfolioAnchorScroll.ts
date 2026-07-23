import { useEffect } from 'react'

// Public-portfolio deep links: a visitor /:section URL renders the full
// continuous portfolio and scrolls to that section's inline anchor.
//
// A fixed-delay scroll misses on HARD loads: the profile fetch (plus the
// gated wrappers' own count fetches, e.g. club members) routinely outlasts
// any one-shot timeout, so the anchor doesn't exist yet when the timer
// fires and the page stays at scrollTop 0. Poll until the anchor mounts,
// scroll, then snap once more after async sections above have finished
// loading and pushed the target down.
const POLL_MS = 150
// ~6s — past this the section isn't coming (empty-gated out or bad URL).
const MAX_ATTEMPTS = 40
const SETTLE_MS = 800

export function usePortfolioAnchorScroll(anchorId: string | null) {
  useEffect(() => {
    if (!anchorId) return
    let attempts = 0
    let settleTimer: number | undefined
    // typeof guard: jsdom has no scrollIntoView (same precedent as the
    // dashboards' tab-content scroll).
    const scrollTo = (behavior?: ScrollBehavior) => {
      const el = document.getElementById(anchorId)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior, block: 'start' })
      }
      return Boolean(el)
    }
    const interval = window.setInterval(() => {
      attempts += 1
      if (scrollTo('smooth')) {
        window.clearInterval(interval)
        settleTimer = window.setTimeout(() => scrollTo(), SETTLE_MS)
      } else if (attempts >= MAX_ATTEMPTS) {
        window.clearInterval(interval)
      }
    }, POLL_MS)
    return () => {
      window.clearInterval(interval)
      if (settleTimer) window.clearTimeout(settleTimer)
    }
  }, [anchorId])
}
