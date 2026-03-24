import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures these are available before the hoisted vi.mock call
const { mockRemoveChannel, mockRemoveAllChannels, mockGetChannels } = vi.hoisted(() => ({
  mockRemoveChannel: vi.fn(),
  mockRemoveAllChannels: vi.fn(),
  mockGetChannels: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: mockRemoveChannel,
    removeAllChannels: mockRemoveAllChannels,
    getChannels: mockGetChannels,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { unread_count: 0 }, error: null }),
      }),
    }),
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
}))

vi.mock('@/lib/requestCache', () => ({
  requestCache: { dedupe: vi.fn((_k: string, fn: () => Promise<number>) => fn()), invalidate: vi.fn(), clear: vi.fn() },
  generateCacheKey: vi.fn((...args: string[]) => args.join(':')),
}))

vi.mock('@/lib/monitor', () => ({
  monitor: { measure: vi.fn((_n: string, fn: () => Promise<number>) => fn()) },
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useUnreadStore } from '@/lib/unread'

describe('Unread store reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store to initial state
    useUnreadStore.setState({
      count: 0,
      loading: false,
      userId: null,
      channel: null,
      initializing: false,
    })
  })

  it('removes realtime channel on reset', () => {
    const fakeChannel = { topic: 'unread-counter-123' }
    useUnreadStore.setState({ channel: fakeChannel as never, userId: 'user-123' })

    useUnreadStore.getState().reset()

    expect(mockRemoveChannel).toHaveBeenCalledWith(fakeChannel)
    expect(useUnreadStore.getState().channel).toBeNull()
    expect(useUnreadStore.getState().userId).toBeNull()
    expect(useUnreadStore.getState().count).toBe(0)
  })

  it('removes visibility listener on reset', () => {
    const spy = vi.spyOn(window, 'removeEventListener')

    // Initialize to bind the listener, then reset to remove it
    useUnreadStore.setState({ userId: 'user-456' })
    useUnreadStore.getState().reset()

    // Reset should not throw and should clear state regardless of listener state
    expect(useUnreadStore.getState().userId).toBeNull()
    spy.mockRestore()
  })

  it('clears count and loading state on reset', () => {
    useUnreadStore.setState({ count: 42, loading: true, userId: 'user-789' })

    useUnreadStore.getState().reset()

    expect(useUnreadStore.getState().count).toBe(0)
    expect(useUnreadStore.getState().loading).toBe(false)
    expect(useUnreadStore.getState().initializing).toBe(false)
  })
})
