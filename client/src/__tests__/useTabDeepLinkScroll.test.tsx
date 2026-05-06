import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'

// Pin the deep-link scroll contract so future regressions surface in CI:
// notification URLs like ?tab=journey or ?tab=profile&section=viewers must
// scroll to the right anchor instead of leaving the user staring at the top
// of the page.

describe('useTabDeepLinkScroll', () => {
  let scrollSpy: ReturnType<typeof vi.fn>
  let rafSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    scrollSpy = vi.fn()
    // Run rAF callback synchronously so the test asserts deterministically.
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    // Mount two anchors representing the typical Player dashboard structure.
    document.body.innerHTML = `
      <div id="profile-tab-content"></div>
      <div id="profile-viewers"></div>
    `
    // Both elements get the same spy so we can assert which was called.
    // Cast through `unknown` because vi.fn's generic signature does not
    // overload-match Element.scrollIntoView's option-bool union directly.
    const scroll = scrollSpy as unknown as Element['scrollIntoView']
    document.getElementById('profile-tab-content')!.scrollIntoView = scroll
    document.getElementById('profile-viewers')!.scrollIntoView = scroll
  })

  afterEach(() => {
    rafSpy.mockRestore()
    document.body.innerHTML = ''
  })

  it('does nothing when neither tab nor section param is present', () => {
    renderHook(() => useTabDeepLinkScroll({ activeTab: 'profile', tabParam: null }))
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('scrolls to the tab content anchor when ?tab= is set', () => {
    renderHook(() => useTabDeepLinkScroll({ activeTab: 'journey', tabParam: 'journey' }))
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls to the section anchor when ?section= matches the anchor map', () => {
    renderHook(() =>
      useTabDeepLinkScroll({
        activeTab: 'profile',
        tabParam: 'profile',
        sectionParam: 'viewers',
        sectionAnchors: { viewers: 'profile-viewers' },
      }),
    )
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to tab anchor when section param does not match the anchor map', () => {
    renderHook(() =>
      useTabDeepLinkScroll({
        activeTab: 'profile',
        tabParam: 'profile',
        sectionParam: 'unknown-section',
        sectionAnchors: { viewers: 'profile-viewers' },
      }),
    )
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the target element is missing', () => {
    document.body.innerHTML = '' // remove all anchors
    expect(() =>
      renderHook(() => useTabDeepLinkScroll({ activeTab: 'journey', tabParam: 'journey' })),
    ).not.toThrow()
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('does not throw when scrollIntoView is missing on the element', () => {
    // jsdom occasionally has no scrollIntoView; guard must hold.
    const el = document.getElementById('profile-tab-content')!
    // @ts-expect-error intentionally simulating missing scrollIntoView
    delete el.scrollIntoView
    expect(() =>
      renderHook(() => useTabDeepLinkScroll({ activeTab: 'journey', tabParam: 'journey' })),
    ).not.toThrow()
  })

  it('cancels the pending rAF on unmount', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    // Defer the rAF so unmount runs before the callback.
    rafSpy.mockImplementation(() => 99)
    const { unmount } = renderHook(() =>
      useTabDeepLinkScroll({ activeTab: 'journey', tabParam: 'journey' }),
    )
    unmount()
    expect(cancelSpy).toHaveBeenCalledWith(99)
  })
})
