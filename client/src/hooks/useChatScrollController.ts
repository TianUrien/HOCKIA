import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

interface UseChatScrollControllerOptions {
  hasMore: boolean
  isLoadingMore: boolean
  loadOlderMessages: () => Promise<boolean>
  onReachBottom?: () => void
  onBeforeLoadOlder?: () => void
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>
  onScrollMetricsChange?: (metrics: { distanceFromBottom: number }) => void
  /**
   * True once the scroll container is in the DOM (the thread is past its
   * skeleton). The scroll listener attaches when this flips, so the caller's
   * callbacks can stay stable across renders without losing the listener.
   */
  ready?: boolean
}

export function useChatScrollController({
  hasMore,
  isLoadingMore,
  loadOlderMessages,
  onReachBottom,
  onBeforeLoadOlder,
  scrollContainerRef: externalScrollRef,
  onScrollMetricsChange,
  ready = true
}: UseChatScrollControllerOptions) {
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = externalScrollRef ?? internalScrollRef
  const isAutoScrollingRef = useRef(false)
  const distanceFromBottomRef = useRef(0)

  // Latest callbacks behind stable refs: `scrollToBottom` and
  // `getDistanceFromBottom` keep one identity for the life of the thread, so
  // effects that depend on them (the "stay pinned" ResizeObserver in
  // ChatWindowV2) don't rebuild on every scroll-driven render. Rebuilding
  // that observer re-fired its initial notification and snapped the thread
  // back to the bottom after every wheel tick (2026-10-14).
  const onReachBottomRef = useRef(onReachBottom)
  onReachBottomRef.current = onReachBottom
  const onBeforeLoadOlderRef = useRef(onBeforeLoadOlder)
  onBeforeLoadOlderRef.current = onBeforeLoadOlder
  const onScrollMetricsChangeRef = useRef(onScrollMetricsChange)
  onScrollMetricsChangeRef.current = onScrollMetricsChange

  const readDistanceFromBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return 0
    }

    return container.scrollHeight - (container.scrollTop + container.clientHeight)
  }, [scrollContainerRef])

  const notifyScrollMetrics = useCallback(() => {
    const distance = readDistanceFromBottom()
    distanceFromBottomRef.current = distance
    onScrollMetricsChangeRef.current?.({ distanceFromBottom: distance })
    return distance
  }, [readDistanceFromBottom])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    isAutoScrollingRef.current = true

    // Use requestAnimationFrame for smoother scroll
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior })
    })

    const finalize = () => {
      isAutoScrollingRef.current = false
      notifyScrollMetrics()
    }

    if (behavior === 'auto') {
      requestAnimationFrame(finalize)
    } else {
      window.setTimeout(finalize, 200)
    }
  }, [notifyScrollMetrics, scrollContainerRef])

  const isViewerAtBottom = useCallback(() => {
    const distanceFromBottom = readDistanceFromBottom()
    return distanceFromBottom <= 150
  }, [readDistanceFromBottom])

  const getDistanceFromBottom = useCallback(() => distanceFromBottomRef.current, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !ready) {
      return
    }

    let ticking = false

    const handleScroll = () => {
      if (isAutoScrollingRef.current || ticking) {
        return
      }

      ticking = true
      requestAnimationFrame(() => {
        if (container.scrollTop < 120 && hasMore && !isLoadingMore) {
          onBeforeLoadOlderRef.current?.()
          void loadOlderMessages()
        }

        notifyScrollMetrics()

        if (isViewerAtBottom()) {
          onReachBottomRef.current?.()
        }

        ticking = false
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    notifyScrollMetrics()

    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [hasMore, isLoadingMore, isViewerAtBottom, loadOlderMessages, notifyScrollMetrics, ready, scrollContainerRef])

  return {
    scrollContainerRef,
    isAutoScrollingRef,
    isViewerAtBottom,
    scrollToBottom,
    getDistanceFromBottom
  }
}
