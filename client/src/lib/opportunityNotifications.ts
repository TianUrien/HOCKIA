import { create } from 'zustand'
import { supabase } from './supabase'
import { requestCache, generateCacheKey } from './requestCache'
import { monitor } from './monitor'
import { logger } from './logger'

interface RefreshOptions {
  bypassCache?: boolean
}

interface OpportunityNotificationState {
  count: number
  loading: boolean
  userId: string | null
  /** Timestamp of when the user last viewed opportunities — used for NEW badge on cards */
  lastSeenAt: string | null
  /** Number of active subscribers - used for cleanup */
  _subscriberCount: number
  /** True once initialize() has run for the current userId — guards against
   * NotificationBridge + Header + MobileBottomNav each firing the same
   * RPC + opportunity_inbox_state query on mount (3× fan-out in prod,
   * 6× under React Strict Mode in dev). The 60s polling interval keeps
   * state fresh after first init, so re-running on every mount is wasted. */
  _initialized: boolean
  initialize: (userId: string | null) => Promise<void>
  refresh: (options?: RefreshOptions) => Promise<number>
  markSeen: () => Promise<void>
  reset: () => void
  /** Call when component mounts to track subscribers */
  subscribe: () => void
  /** Call when component unmounts to allow cleanup */
  unsubscribe: () => void
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

const fetchOpportunityCount = async (userId: string, options?: RefreshOptions): Promise<number> => {
  const cacheKey = generateCacheKey('opportunity_alerts', { userId })
  if (options?.bypassCache) {
    requestCache.invalidate(cacheKey)
  }

  try {
    const count = await monitor.measure(
      'fetch_opportunity_alerts',
      async () => {
        return await requestCache.dedupe(
          cacheKey,
          async () => {
            const { data, error } = await supabase.rpc('get_opportunity_alerts')

            if (error) {
              logger.error('[OPPORTUNITY_ALERTS] Failed to fetch unseen opportunities:', error)
              return 0
            }

            if (typeof data === 'number') {
              return data
            }

            if (Array.isArray(data)) {
              const first = data[0] as { get_opportunity_alerts?: number; unseen_count?: number } | undefined
              return first?.get_opportunity_alerts ?? first?.unseen_count ?? 0
            }

            if (data && typeof data === 'object' && 'unseen_count' in data) {
              return Number((data as Record<string, unknown>).unseen_count) || 0
            }

            return 0
          },
          5000
        )
      },
      { userId }
    )

    return count
  } catch (error) {
    logger.error('[OPPORTUNITY_ALERTS] Unexpected error fetching unseen opportunities:', error)
    return 0
  }
}

export const useOpportunityNotificationStore = create<OpportunityNotificationState>((set, get) => ({
  count: 0,
  loading: false,
  userId: null,
  lastSeenAt: null,
  _subscriberCount: 0,
  _initialized: false,

  subscribe: () => {
    set((state) => ({ _subscriberCount: state._subscriberCount + 1 }))
  },

  unsubscribe: () => {
    const { _subscriberCount } = get()
    const newCount = Math.max(0, _subscriberCount - 1)
    set({ _subscriberCount: newCount })
    
    // If no more subscribers, clean up the interval
    if (newCount === 0 && refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
  },

  reset: () => {
    if (refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
    set({ count: 0, loading: false, userId: null, lastSeenAt: null, _subscriberCount: 0, _initialized: false })
  },

  refresh: async (options?: RefreshOptions) => {
    const { userId } = get()
    if (!userId) {
      set({ count: 0, loading: false })
      return 0
    }

    set({ loading: true })
    const count = await fetchOpportunityCount(userId, options)
    set({ count, loading: false })
    return count
  },

  initialize: async (userId: string | null) => {
    const { userId: currentUserId, refresh, _subscriberCount, _initialized } = get()

    if (!userId) {
      get().reset()
      return
    }

    // Short-circuit if already initialized for this user. NotificationBridge,
    // Header, and MobileBottomNav all mount this hook in the same render
    // tree — without this guard each one re-fires get_opportunity_alerts +
    // opportunity_inbox_state on every page load. Polling interval below
    // keeps state fresh; no need to refetch on every mount.
    if (_initialized && currentUserId === userId) {
      return
    }

    // Set userId + initialized flag synchronously so concurrent mounts that
    // race past the guard above (e.g. all 3 hooks fire in the same tick)
    // see _initialized=true on their next read and bail out of the network
    // calls below.
    set({ userId, _initialized: true })
    await refresh({ bypassCache: true })

    // Fetch lastSeenAt for NEW badge computation
    try {
      const { data: inboxState } = await supabase
        .from('opportunity_inbox_state')
        .select('last_seen_at')
        .eq('user_id', userId)
        .maybeSingle()
      set({ lastSeenAt: inboxState?.last_seen_at ?? null })
    } catch {
      // No inbox state yet — all opportunities are "new"
    }

    // Only start interval if we have subscribers and no existing interval
    if (_subscriberCount > 0 && !refreshInterval) {
      refreshInterval = setInterval(() => {
        void get().refresh({ bypassCache: true })
      }, 60000)
    }
  },

  markSeen: async () => {
    const { userId, refresh } = get()
    if (!userId) {
      return
    }

    const { error } = await supabase.rpc('mark_opportunities_seen')

    if (error) {
      logger.error('[OPPORTUNITY_ALERTS] Failed to mark opportunities as seen:', error)
      return
    }

    set({ count: 0 })
    await refresh({ bypassCache: true })
  }
}))
