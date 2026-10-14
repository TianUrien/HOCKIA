import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useQueuedToggle } from '@/hooks/useQueuedToggle'

describe('useQueuedToggle (QA F4: double tap)', () => {
  it('saves taps one after another and ends on the value shown', async () => {
    const calls: boolean[] = []
    let release: (() => void) | null = null
    const save = vi.fn((next: boolean) => new Promise<boolean>((resolve) => { calls.push(next); release = () => resolve(true) }))
    const { result } = renderHook(() => useQueuedToggle(false, save))

    act(() => { result.current.toggle() })          // tap 1 → on
    act(() => { result.current.toggle() })          // tap 2 → off, while tap 1 is saving
    expect(result.current.value).toBe(false)
    expect(calls).toEqual([true])                    // never two saves at once

    await act(async () => { release?.() })           // tap 1 done → tap 2 saves
    expect(calls).toEqual([true, false])
    await act(async () => { release?.() })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('falls back and reports when a save fails', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useQueuedToggle(false, async () => false, onError))
    await act(async () => { result.current.toggle() })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe(false)
  })
})
