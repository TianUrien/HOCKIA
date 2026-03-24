import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { requestCache, generateCacheKey } from './requestCache'
import { monitor } from './monitor'
import { logger } from './logger'

let visibilityHandler: (() => void) | null = null

type RefreshOptions = {
  bypassCache?: boolean
}

interface UnreadState {
  count: number
  loading: boolean
  userId: string | null
  channel: RealtimeChannel | null
  /** Tracks if initialization is in progress to prevent duplicate calls */
  initializing: boolean
  initialize: (userId: string | null) => Promise<void>
  refresh: (options?: RefreshOptions) => Promise<number>
  reset: () => void
}

const fetchUnreadCount = async (userId: string, options?: RefreshOptions): Promise<number> => {
  const cacheKey = generateCacheKey('unread_count', { userId })
  if (options?.bypassCache) {
    requestCache.invalidate(cacheKey)
  }

  try {
    const count = await monitor.measure('fetch_unread_count', async () => {
      return await requestCache.dedupe(
        cacheKey,
        async () => {
          const { data, error } = await supabase
            .from('user_unread_counts_secure')
            .select('unread_count')
            .maybeSingle()

          if (error) {
            logger.error('[UNREAD] Failed to fetch unread count:', error)
            return 0
          }

          return data?.unread_count ?? 0
        },
        5000
      )
    }, { userId })

    return count
  } catch (error) {
    logger.error('[UNREAD] Unexpected error fetching unread count:', error)
    return 0
  }
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  count: 0,
  loading: false,
  userId: null,
  channel: null,
  initializing: false,

  reset: () => {
    const { channel } = get()
    if (channel) {
      supabase.removeChannel(channel)
    }
    if (visibilityHandler) {
      window.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    set({ count: 0, loading: false, userId: null, channel: null, initializing: false })
  },

  refresh: async (options?: RefreshOptions) => {
    const { userId } = get()
    if (!userId) {
      set({ count: 0, loading: false })
      return 0
    }

    set({ loading: true })
    const count = await fetchUnreadCount(userId, options)
    set({ count, loading: false })
    return count
  },

  initialize: async (userId: string | null) => {
    const { userId: currentUserId, channel: existingChannel, refresh, initializing } = get()

    if (!userId) {
      get().reset()
      return
    }

    // Skip if already initializing for the same user (prevents duplicate calls from multiple components)
    if (initializing && currentUserId === userId) {
      return
    }

    // Skip if already initialized for this user with an active channel
    if (currentUserId === userId && existingChannel) {
      return
    }

    set({ initializing: true })

    const shouldResubscribe = currentUserId !== userId || !existingChannel

    if (currentUserId !== userId && existingChannel) {
      await supabase.removeChannel(existingChannel)
    }

    set({ userId, channel: shouldResubscribe ? null : existingChannel })
    await refresh({ bypassCache: true })

    if (!shouldResubscribe && existingChannel) {
      return
    }

    const channel = supabase
      .channel(`unread-counter-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_unread_counters',
          filter: `user_id=eq.${userId}`
        },
        payload => {
          const newRecord = payload.new as { unread_count?: number } | null
          const oldRecord = payload.old as { unread_count?: number } | null
          
          const nextCount = typeof newRecord?.unread_count === 'number'
            ? newRecord.unread_count
            : Math.max(0, Number(oldRecord?.unread_count) || 0)

          set({ count: nextCount })
        }
      )
      .subscribe()

    set({ channel, initializing: false })

    // Bind visibility listener (cleaned up on reset) to refresh when tab regains focus
    if (typeof window !== 'undefined' && !visibilityHandler) {
      visibilityHandler = () => {
        if (document.visibilityState !== 'hidden' && get().userId) {
          void get().refresh({ bypassCache: true })
        }
      }
      window.addEventListener('visibilitychange', visibilityHandler)
    }
  }
}))
