import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useChatScrollController } from '@/hooks/useChatScrollController'

function container(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
  return el
}

describe('useChatScrollController', () => {
  it('keeps scrollToBottom and getDistanceFromBottom stable while the callbacks change every render', () => {
    const el = container(1000, 400, 600)
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        const ref = useRef<HTMLDivElement | null>(el)
        return useChatScrollController({
          hasMore: false,
          isLoadingMore: false,
          loadOlderMessages: async () => false,
          // New identities on purpose: the inline arrows ChatWindowV2 used to pass.
          onReachBottom: () => tick,
          onScrollMetricsChange: () => tick,
          scrollContainerRef: ref,
        })
      },
      { initialProps: { tick: 0 } }
    )
    const first = result.current
    rerender({ tick: 1 })
    rerender({ tick: 2 })
    expect(result.current.scrollToBottom).toBe(first.scrollToBottom)
    expect(result.current.getDistanceFromBottom).toBe(first.getDistanceFromBottom)
  })

  it('attaches the scroll listener once the thread is ready and reports the latest callbacks', () => {
    const el = container(1000, 400, 600)
    const reached: number[] = []
    const { rerender } = renderHook(
      ({ ready, tick }: { ready: boolean; tick: number }) => {
        const ref = useRef<HTMLDivElement | null>(el)
        return useChatScrollController({
          hasMore: false,
          isLoadingMore: false,
          loadOlderMessages: async () => false,
          onReachBottom: () => reached.push(tick),
          scrollContainerRef: ref,
          ready,
        })
      },
      { initialProps: { ready: false, tick: 0 } }
    )
    vi.useFakeTimers()
    try {
      el.dispatchEvent(new Event('scroll'))
      vi.runAllTimers()
      expect(reached).toEqual([])
      rerender({ ready: true, tick: 1 })
      rerender({ ready: true, tick: 2 })
      el.dispatchEvent(new Event('scroll'))
      vi.runAllTimers()
      // At the bottom (distance 0) → onReachBottom, with the newest callback.
      expect(reached).toEqual([2])
    } finally {
      vi.useRealTimers()
    }
  })
})
