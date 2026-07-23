import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePortfolioAnchorScroll } from '@/hooks/usePortfolioAnchorScroll'

// REGRESSION (staging QA 2026-07-23): visitor deep links (/members, /media…)
// loaded the portfolio but never scrolled — the old two-shot 150ms/600ms
// timeouts expired before the profile fetch mounted the anchors on a hard
// load, and nothing retried. The hook must poll until the anchor APPEARS.

function Harness({ anchorId }: { anchorId: string | null }) {
  usePortfolioAnchorScroll(anchorId)
  return null
}

describe('usePortfolioAnchorScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('scrolls to an anchor that mounts LATE (after the old 600ms budget)', () => {
    const scrollSpy = vi.fn()
    render(<Harness anchorId="portfolio-members" />)

    // Nothing in the DOM yet — burn well past the old two-shot window.
    vi.advanceTimersByTime(1200)

    // Anchor appears late (profile + member-count fetches resolved).
    const el = document.createElement('div')
    el.id = 'portfolio-members'
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    vi.advanceTimersByTime(300)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    // Settle snap re-fires after async sections above shift layout.
    vi.advanceTimersByTime(1000)
    expect(scrollSpy).toHaveBeenCalledTimes(2)
    expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: undefined, block: 'start' })
  })

  it('gives up quietly when the anchor never appears (empty-gated section)', () => {
    render(<Harness anchorId="portfolio-media" />)
    // Full poll budget: MAX_ATTEMPTS(40) × POLL_MS(150) — must not throw.
    expect(() => vi.advanceTimersByTime(7000)).not.toThrow()
  })

  it('does nothing for a null anchor (owner view / excluded sections)', () => {
    const spy = vi.spyOn(document, 'getElementById')
    render(<Harness anchorId={null} />)
    vi.advanceTimersByTime(2000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('stops polling on unmount', () => {
    const spy = vi.spyOn(document, 'getElementById')
    const { unmount } = render(<Harness anchorId="portfolio-media" />)
    vi.advanceTimersByTime(450)
    const callsBeforeUnmount = spy.mock.calls.length
    expect(callsBeforeUnmount).toBeGreaterThan(0)
    unmount()
    vi.advanceTimersByTime(3000)
    expect(spy.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
