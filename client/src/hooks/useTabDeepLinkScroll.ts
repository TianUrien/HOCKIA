import { useEffect } from 'react'

interface UseTabDeepLinkScrollOptions {
  /**
   * The currently active tab id. Used to gate the scroll: when the URL
   * arrives with a different tab than the one currently rendered (e.g.
   * notification opens ?tab=journey while the user was on Profile), we
   * wait for the dashboard's own effect to catch `activeTab` up before
   * scrolling — otherwise the section anchor might not yet be in the DOM.
   */
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
   *
   * IMPORTANT: pass a stable reference (module-level `const` or
   * `useMemo`). Inline object literals would change every render and
   * cause the effect to re-fire repeatedly. Not passing it (undefined)
   * is the simplest stable form.
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
 * Behaviour:
 *   - Fires when params + activeTab agree, so a single scroll happens
 *     per navigation.
 *   - Defensive against jsdom (where `scrollIntoView` is a stub or
 *     absent).
 *   - Fires the scroll TWICE: once on the next rAF (immediate visual
 *     feedback) and once at 400ms (after async tab content like
 *     FriendsTab's fetchConnections has settled). Without the late
 *     re-scroll, the smooth-scroll target computed during the skeleton
 *     phase is stale by the time content swaps in — the strip ends up
 *     mid-viewport instead of at the top.
 *   - Cleans up if the component unmounts before the frame/timeout fires.
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

    // If the URL says ?tab=X but the dashboard's own state hasn't caught
    // up yet (the dashboard's tabParam→setActiveTab effect runs in the
    // same commit as ours, before re-render), wait for the next pass.
    // Without this guard, the effect would fire twice on cross-tab
    // navigation: once before the new tab content is in the DOM (silent
    // miss for section anchors) and once after (the visible scroll). The
    // user would see a brief double-scroll.
    if (tabParam && activeTab !== tabParam) return

    let targetId: string | null = null
    if (sectionParam && sectionAnchors && sectionAnchors[sectionParam]) {
      targetId = sectionAnchors[sectionParam]
    } else if (tabParam) {
      targetId = tabContentAnchorId
    }
    if (!targetId) return

    let cancelled = false
    const performScroll = () => {
      if (cancelled) return
      const el = document.getElementById(targetId!)
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
      }
    }
    // First scroll: rAF after current render commit.
    const rafId = window.requestAnimationFrame(performScroll)
    // Second scroll: re-fire after async tab content (e.g. FriendsTab
    // connections fetch) has had time to load and shift the layout.
    // 400ms covers a typical fetch round-trip + render. Cheap enough that
    // it's also fine when the tab loaded synchronously — the second
    // scroll is a no-op when the first already landed correctly.
    const settleTimeoutId = window.setTimeout(performScroll, 400)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(settleTimeoutId)
    }
  }, [tabParam, sectionParam, activeTab, sectionAnchors, tabContentAnchorId])
}
