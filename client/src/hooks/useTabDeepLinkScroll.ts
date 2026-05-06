import { useEffect } from 'react'

interface UseTabDeepLinkScrollOptions {
  /** The currently active tab id (drives the dependency). */
  activeTab: string
  /** The `?tab=` query param value, or null. */
  tabParam: string | null
  /**
   * The `?section=` query param value, or null. When set and a matching
   * section anchor id is present in the DOM, scrolls to that section
   * instead of the top of the tab content.
   *
   * Pass `undefined` if the dashboard has no per-section anchors.
   */
  sectionParam?: string | null
  /**
   * Map of `?section=` values to the DOM id of the matching anchor.
   * Only the keys here will be honoured. Pass undefined if no sections.
   */
  sectionAnchors?: Readonly<Record<string, string>>
  /**
   * The DOM id of the tab content container — used as the fallback
   * scroll target when `?tab=` is set without a matching section.
   *
   * Defaults to `"profile-tab-content"`. Pass an explicit id if your
   * dashboard uses a different anchor.
   */
  tabContentAnchorId?: string
}

/**
 * Scroll-on-deep-link for dashboards that read `?tab=` / `?section=`
 * from the URL. Without this, notifications and shareable URLs land at
 * the top of the dashboard instead of the section the user was sent to.
 *
 * Defensive against jsdom (where `scrollIntoView` is a stub or absent),
 * waits one rAF for the tab content to mount, and cleans up if the
 * component unmounts before the frame fires.
 */
export function useTabDeepLinkScroll({
  activeTab,
  tabParam,
  sectionParam,
  sectionAnchors,
  tabContentAnchorId = 'profile-tab-content',
}: UseTabDeepLinkScrollOptions): void {
  useEffect(() => {
    if (!tabParam && !sectionParam) return

    let targetId: string | null = null
    if (sectionParam && sectionAnchors && sectionAnchors[sectionParam]) {
      targetId = sectionAnchors[sectionParam]
    } else if (tabParam) {
      targetId = tabContentAnchorId
    }
    if (!targetId) return

    let cancelled = false
    const id = window.requestAnimationFrame(() => {
      if (cancelled) return
      const el = document.getElementById(targetId!)
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
      }
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [tabParam, sectionParam, activeTab, sectionAnchors, tabContentAnchorId])
}
