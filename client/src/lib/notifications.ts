import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { requestCache, generateCacheKey } from './requestCache'
import { logger } from './logger'
import {
  fetchNotificationsPage,
  markNotificationRead as markNotificationReadRpc,
  markAllNotificationsRead as markAllNotificationsReadRpc,
  clearNotifications as clearNotificationsRpc,
  type NotificationKind,
  type NotificationRecord,
  type NotificationMetadata,
} from './api/notifications'
import type { Tables } from './database.types'

const NOTIFICATION_LIMIT = 40
const HEARTBEAT_INTERVAL_MS = 60_000
const CHANNEL_RECONNECT_BASE_DELAY_MS = 2000
const CHANNEL_RECONNECT_MAX_DELAY_MS = 30_000
let lifecycleListenersBound = false
let realtimeVerifyTimeoutId: ReturnType<typeof setTimeout> | undefined

type ProfileNotificationRow = Tables<'profile_notifications'>

interface ActorProfile {
  id: string
  full_name: string | null
  role: string | null
  username: string | null
  avatar_url: string | null
  base_location: string | null
}

// Cache for actor profiles to avoid refetching on every realtime notification
const actorProfileCache = new Map<string, ActorProfile>()
const ACTOR_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const actorCacheTimestamps = new Map<string, number>()

/** Clears the actor profile cache to prevent memory leaks across sessions */
const clearActorCache = () => {
  actorProfileCache.clear()
  actorCacheTimestamps.clear()
}

const fetchActorProfile = async (actorId: string): Promise<ActorProfile | null> => {
  const now = Date.now()
  const cachedTs = actorCacheTimestamps.get(actorId)
  
  if (cachedTs && now - cachedTs < ACTOR_CACHE_TTL_MS) {
    return actorProfileCache.get(actorId) ?? null
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, username, avatar_url, base_location')
      .eq('id', actorId)
      .single()

    if (error || !data) {
      return null
    }

    actorProfileCache.set(actorId, data)
    actorCacheTimestamps.set(actorId, now)
    return data
  } catch (err) {
    logger.warn('[NOTIFICATIONS] Failed to fetch actor profile', { actorId, error: err })
    return null
  }
}

const mapRealtimeNotification = (row: ProfileNotificationRow, actorProfile?: ActorProfile | null): NotificationRecord => ({
  id: row.id,
  kind: row.kind,
  sourceEntityId: row.source_entity_id,
  metadata: (row.metadata ?? {}) as NotificationMetadata,
  targetUrl: row.target_url,
  createdAt: row.created_at,
  readAt: row.read_at,
  seenAt: row.seen_at,
  clearedAt: row.cleared_at,
  actor: {
    id: row.actor_profile_id,
    fullName: actorProfile?.full_name ?? null,
    role: actorProfile?.role ?? null,
    username: actorProfile?.username ?? null,
    avatarUrl: actorProfile?.avatar_url ?? null,
    baseLocation: actorProfile?.base_location ?? null,
  },
})

interface RefreshOptions {
  bypassCache?: boolean
}

interface NotificationState {
  notifications: NotificationRecord[]
  unreadCount: number
  isDrawerOpen: boolean
  loading: boolean
  userId: string | null
  channel: RealtimeChannel | null
  pendingFriendshipId: string | null
  pendingAmbassadorRequestId: string | null
  pendingCommentHighlights: Set<string>
  commentHighlightVersion: number
  heartbeatIntervalId: number | null
  reconnectTimeoutId: number | null
  reconnectAttempts: number
  /** IDs optimistically marked as read but not yet confirmed by the server */
  pendingReadIds: Set<string>
  initialize: (userId: string | null, options?: { force?: boolean }) => Promise<void>
  toggleDrawer: (open?: boolean) => void
  refresh: (options?: RefreshOptions) => Promise<void>
  markRead: (notificationId: string) => Promise<void>
  markAllRead: () => Promise<void>
  clearCommentNotifications: () => Promise<void>
  claimCommentHighlights: () => string[]
  respondToFriendRequest: (params: { friendshipId: string; action: 'accept' | 'decline' }) => Promise<boolean>
  respondToAmbassadorRequest: (params: { ambassadorId: string; action: 'accept' | 'decline' }) => Promise<boolean>
  dismissBySource: (kind: NotificationKind, sourceId: string | null) => void
}


const fetchNotifications = async (userId: string, options?: RefreshOptions): Promise<NotificationRecord[]> => {
  const cacheKey = generateCacheKey('profile_notifications', { userId })
  if (options?.bypassCache) {
    requestCache.invalidate(cacheKey)
  }

  return await requestCache.dedupe(cacheKey, async () => {
    try {
      return await fetchNotificationsPage({
        filter: 'all',
        limit: NOTIFICATION_LIMIT,
        offset: 0,
      })
    } catch (error) {
      logger.error('[NOTIFICATIONS] Failed to fetch notifications', error)
      return []
    }
  }, 3000)
}

const extractCommentId = (notification: NotificationRecord): string | null => {
  if (notification.kind !== 'profile_comment_created') {
    return null
  }

  const value = notification.metadata?.['comment_id']
  if (typeof value === 'string' && value) {
    return value
  }

  return null
}

const upsertNotification = (
  notification: NotificationRecord,
  state: Pick<NotificationState, 'notifications' | 'pendingCommentHighlights' | 'commentHighlightVersion'>
) => {
  const next = [...state.notifications]
  const index = next.findIndex((item) => item.id === notification.id)

  if (notification.clearedAt) {
    if (index >= 0) {
      next.splice(index, 1)
    }
  } else if (index >= 0) {
    next[index] = notification
  } else {
    next.unshift(notification)
    next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  let pendingHighlights = state.pendingCommentHighlights
  let highlightVersion = state.commentHighlightVersion
  const commentId = extractCommentId(notification)

  if (commentId) {
    const shouldHighlight = !notification.readAt && !notification.clearedAt
    if (shouldHighlight) {
      const clone = new Set(pendingHighlights)
      clone.add(commentId)
      pendingHighlights = clone
      highlightVersion += 1
    } else if (pendingHighlights.has(commentId)) {
      const clone = new Set(pendingHighlights)
      clone.delete(commentId)
      pendingHighlights = clone
      highlightVersion += 1
    }
  }

  const unreadCount = next.filter((item) => !item.readAt && !item.clearedAt).length

  return {
    notifications: next,
    pendingCommentHighlights: pendingHighlights,
    commentHighlightVersion: highlightVersion,
    unreadCount,
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => {
  const isBrowser = typeof window !== 'undefined'
  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)
  const isPageHidden = () => (typeof document === 'undefined' ? false : document.visibilityState === 'hidden')

  const clearHeartbeat = () => {
    const heartbeatIntervalId = get().heartbeatIntervalId
    if (heartbeatIntervalId !== null && isBrowser) {
      window.clearInterval(heartbeatIntervalId)
      set({ heartbeatIntervalId: null })
    }
  }

  const clearReconnectTimeout = () => {
    const reconnectTimeoutId = get().reconnectTimeoutId
    if (reconnectTimeoutId !== null && isBrowser) {
      window.clearTimeout(reconnectTimeoutId)
      set({ reconnectTimeoutId: null })
    }
  }

  const scheduleReconnect = () => {
    if (!isBrowser || !isOnline()) {
      return
    }
    clearHeartbeat()
    const { reconnectTimeoutId, reconnectAttempts, userId } = get()
    if (reconnectTimeoutId !== null || !userId) {
      return
    }
    const delay = Math.min(
      CHANNEL_RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts),
      CHANNEL_RECONNECT_MAX_DELAY_MS
    )
    const timeoutId = window.setTimeout(() => {
      set({ reconnectTimeoutId: null, reconnectAttempts: reconnectAttempts + 1 })
      void get().initialize(userId, { force: true })
    }, delay)
    set({ reconnectTimeoutId: timeoutId })
  }

  const performHeartbeat = () => {
    if (!isBrowser || isPageHidden()) {
      return
    }

    const { userId, channel, isDrawerOpen } = get()
    if (!userId) {
      return
    }

    // Only perform full refresh when drawer is open (user actively viewing notifications)
    // This reduces unnecessary API calls while maintaining realtime updates via channel
    if (isDrawerOpen) {
      void get().refresh({ bypassCache: true })
    }

    if (!channel) {
      scheduleReconnect()
      return
    }

    channel
      .send({
        type: 'broadcast',
        event: 'heartbeat',
        payload: { timestamp: Date.now() },
      })
      .then((response) => {
        if (response !== 'ok') {
          scheduleReconnect()
        }
      })
      .catch((error) => {
        logger.error('[NOTIFICATIONS] Heartbeat failed', error)
        scheduleReconnect()
      })
  }

  const startHeartbeat = () => {
    if (!isBrowser) {
      return
    }
    clearHeartbeat()
    performHeartbeat()
    const intervalId = window.setInterval(() => {
      performHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    set({ heartbeatIntervalId: intervalId })
  }

  const bindLifecycleEvents = () => {
    if (!isBrowser || lifecycleListenersBound) {
      return
    }

    const handleVisibilityChange = () => {
      if (!isPageHidden()) {
        // Force refresh on tab focus to catch any events missed while hidden
        void get().refresh({ bypassCache: true })
        performHeartbeat()
      }
    }

    const handleOnline = () => {
      const { userId } = get()
      if (!userId) {
        return
      }
      clearHeartbeat()
      clearReconnectTimeout()
      set({ reconnectAttempts: 0 })
      void get().initialize(userId, { force: true })
    }

    const handleOffline = () => {
      clearHeartbeat()
      clearReconnectTimeout()
    }

    window.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    lifecycleListenersBound = true
  }

  const teardownChannel = async () => {
    const { channel } = get()
    clearHeartbeat()
    clearReconnectTimeout()
    clearTimeout(realtimeVerifyTimeoutId)
    realtimeVerifyTimeoutId = undefined
    if (channel) {
      await supabase.removeChannel(channel)
    }
  }

  const attachChannel = (userId: string) => {
    const nextChannel = supabase
      .channel(`profile-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profile_notifications',
          filter: `recipient_profile_id=eq.${userId}`,
        },
        async (change) => {
          const record = change.new ?? change.old
          if (!record) {
            return
          }

          const row = record as ProfileNotificationRow
          const actorId = row.actor_profile_id

          // Fetch actor profile to display sender info immediately
          let actorProfile: ActorProfile | null = null
          if (actorId) {
            actorProfile = await fetchActorProfile(actorId)
          }

          const normalized = mapRealtimeNotification(row, actorProfile)
          set((state) => ({
            ...upsertNotification(normalized, state),
          }))

          // Debounced verification: re-fetch from server 3s after last realtime event
          // to catch malformed payloads or missed events. Multiple rapid events batch into one fetch.
          clearTimeout(realtimeVerifyTimeoutId)
          realtimeVerifyTimeoutId = setTimeout(() => {
            void get().refresh({ bypassCache: true })
          }, 3000)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          set({ reconnectAttempts: 0 })
          clearReconnectTimeout()
          startHeartbeat()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect()
        }
      })

    return nextChannel
  }

  return {
    notifications: [],
    unreadCount: 0,
    isDrawerOpen: false,
    loading: false,
    userId: null,
    channel: null,
    pendingFriendshipId: null,
    pendingAmbassadorRequestId: null,
    pendingCommentHighlights: new Set<string>(),
    commentHighlightVersion: 0,
    heartbeatIntervalId: null,
    reconnectTimeoutId: null,
    reconnectAttempts: 0,
    pendingReadIds: new Set<string>(),

    toggleDrawer: (open) => {
      const currentOpen = get().isDrawerOpen
      const nextOpen = typeof open === 'boolean' ? open : !currentOpen
      if (currentOpen === nextOpen) {
        return
      }
      set({ isDrawerOpen: nextOpen })
      
      // Refresh notifications when drawer opens to ensure fresh data
      if (nextOpen) {
        void get().refresh({ bypassCache: true })
      }
    },

    initialize: async (userId: string | null, options?: { force?: boolean }) => {
      const { userId: currentUserId, channel } = get()

      if (!userId) {
        await teardownChannel()
        clearActorCache() // Clear actor cache on signout to prevent memory leak
        set({
          userId: null,
          channel: null,
          notifications: [],
          unreadCount: 0,
          pendingAmbassadorRequestId: null,
          pendingReadIds: new Set<string>(),
          pendingCommentHighlights: new Set<string>(),
          commentHighlightVersion: 0,
          reconnectAttempts: 0,
        })
        return
      }

      bindLifecycleEvents()

      if (!options?.force && currentUserId === userId && channel) {
        return
      }

      // Clear actor cache when switching users to prevent stale data and memory leaks
      if (currentUserId !== userId) {
        clearActorCache()
      }

      await teardownChannel()
      set({ userId, channel: null })
      await get().refresh({ bypassCache: true })

      // Warn if too many realtime channels are open (indicates a leak somewhere)
      const activeChannels = supabase.getChannels()
      if (activeChannels.length > 10) {
        logger.warn('[NOTIFICATIONS] High realtime channel count — possible leak', {
          count: activeChannels.length,
          names: activeChannels.map(c => c.topic).slice(0, 15),
        })
      }

      const nextChannel = attachChannel(userId)
      set({ channel: nextChannel })
    },

    refresh: async (options?: RefreshOptions) => {
      const { userId } = get()
      if (!userId) {
        set({ notifications: [], unreadCount: 0 })
        return
      }

      set({ loading: true })
      const rows = await fetchNotifications(userId, options)

      // Preserve optimistic reads that haven't been confirmed by the server yet
      const { pendingReadIds } = get()
      const mergedRows = pendingReadIds.size > 0
        ? rows.map((row) => {
            if (pendingReadIds.has(row.id) && !row.readAt) {
              return { ...row, readAt: new Date().toISOString(), seenAt: row.seenAt ?? new Date().toISOString() }
            }
            return row
          })
        : rows

      let pendingHighlights = get().pendingCommentHighlights
      let highlightVersion = get().commentHighlightVersion

      mergedRows.forEach((notification) => {
        const commentId = extractCommentId(notification)
        if (commentId && !notification.readAt && !notification.clearedAt) {
          if (!pendingHighlights.has(commentId)) {
            const clone = new Set(pendingHighlights)
            clone.add(commentId)
            pendingHighlights = clone
            highlightVersion += 1
          }
        }
      })

      const unreadCount = mergedRows.filter((item) => !item.readAt && !item.clearedAt).length

      set({
        notifications: mergedRows,
        unreadCount,
        loading: false,
        pendingCommentHighlights: pendingHighlights,
        commentHighlightVersion: highlightVersion,
      })
    },

    markRead: async (notificationId: string) => {
      const { notifications } = get()
      const target = notifications.find((n) => n.id === notificationId)
      if (!target || target.readAt) return

      const nowIso = new Date().toISOString()

      // Track this ID so concurrent refreshes won't overwrite the optimistic update
      set((state) => {
        const nextPending = new Set(state.pendingReadIds)
        nextPending.add(notificationId)
        const next = state.notifications.map((n) =>
          n.id === notificationId ? { ...n, readAt: n.readAt ?? nowIso, seenAt: n.seenAt ?? nowIso } : n
        )
        return {
          notifications: next,
          unreadCount: next.filter((n) => !n.readAt && !n.clearedAt).length,
          pendingReadIds: nextPending,
        }
      })

      try {
        await markNotificationReadRpc(notificationId)
      } catch (error) {
        logger.error('[NOTIFICATIONS] Failed to mark notification read', error)
      } finally {
        // Remove from pending set and ensure readAt is still applied
        set((state) => {
          const nextPending = new Set(state.pendingReadIds)
          nextPending.delete(notificationId)
          const next = state.notifications.map((n) =>
            n.id === notificationId && !n.readAt
              ? { ...n, readAt: nowIso, seenAt: n.seenAt ?? nowIso }
              : n
          )
          return {
            notifications: next,
            unreadCount: next.filter((n) => !n.readAt && !n.clearedAt).length,
            pendingReadIds: nextPending,
          }
        })
      }
    },

    markAllRead: async () => {
      const { userId } = get()
      if (!userId) {
        return
      }

      try {
        await markAllNotificationsReadRpc()
      } catch (error) {
        logger.error('[NOTIFICATIONS] Failed to mark notifications read', error)
        return
      }

      const nowIso = new Date().toISOString()
      set((state) => ({
        notifications: state.notifications.map((item) => ({
          ...item,
          readAt: item.readAt ?? nowIso,
          seenAt: item.seenAt ?? nowIso,
        })),
        unreadCount: 0,
      }))
    },

    clearCommentNotifications: async () => {
      const { userId } = get()
      if (!userId) {
        return
      }

      try {
        await clearNotificationsRpc({ kind: 'profile_comment_created' })
      } catch (error) {
        logger.error('[NOTIFICATIONS] Failed to clear comment notifications', error)
        return
      }

      set((state) => {
        const next = state.notifications.filter((item) => item.kind !== 'profile_comment_created')
        const unreadCount = next.filter((item) => !item.readAt && !item.clearedAt).length
        return {
          notifications: next,
          unreadCount,
          pendingCommentHighlights: new Set<string>(),
          commentHighlightVersion: state.commentHighlightVersion + 1,
        }
      })
    },

    claimCommentHighlights: () => {
      const { pendingCommentHighlights } = get()
      if (pendingCommentHighlights.size === 0) {
        return []
      }

      const ids = Array.from(pendingCommentHighlights)
      set({ pendingCommentHighlights: new Set<string>(), commentHighlightVersion: get().commentHighlightVersion + 1 })
      return ids
    },

    respondToFriendRequest: async ({ friendshipId, action }) => {
      if (!friendshipId) {
        return false
      }

      set({ pendingFriendshipId: friendshipId })

      try {
        const nextStatus = action === 'accept' ? 'accepted' : 'rejected'
        const { error } = await supabase
          .from('profile_friendships')
          .update({ status: nextStatus })
          .eq('id', friendshipId)

        if (error) {
          logger.error('[NOTIFICATIONS] Failed to update friend request', error)
          return false
        }

        // Optimistically remove the notification from local state
        set((state) => ({
          pendingFriendshipId: null,
          notifications: state.notifications.filter((item) => item.sourceEntityId !== friendshipId),
          unreadCount: state.notifications.filter(
            (item) => item.sourceEntityId !== friendshipId && !item.readAt && !item.clearedAt
          ).length,
        }))

        // Force refresh to sync with server state (handles realtime channel issues)
        // Use a short delay to allow the database trigger to process the status change
        setTimeout(() => {
          void get().refresh({ bypassCache: true })
        }, 500)

        return true
      } finally {
        set((state) => (state.pendingFriendshipId === friendshipId ? { pendingFriendshipId: null } : {}))
      }
    },

    respondToAmbassadorRequest: async ({ ambassadorId, action }) => {
      if (!ambassadorId) {
        return false
      }

      set({ pendingAmbassadorRequestId: ambassadorId })

      try {
        const accept = action === 'accept'
         
        const { data, error } = await supabase.rpc('respond_to_ambassador_request', {
          p_brand_ambassador_id: ambassadorId,
          p_accept: accept,
        })

        if (error) {
          logger.error('[NOTIFICATIONS] Failed to respond to ambassador request', error)
          return false
        }

        const result = data as { success: boolean; error?: string }
        if (!result.success) {
          logger.error('[NOTIFICATIONS] Ambassador request response failed', result.error)
          return false
        }

        // Optimistically remove the notification from local state
        set((state) => ({
          pendingAmbassadorRequestId: null,
          notifications: state.notifications.filter((item) => item.sourceEntityId !== ambassadorId),
          unreadCount: state.notifications.filter(
            (item) => item.sourceEntityId !== ambassadorId && !item.readAt && !item.clearedAt
          ).length,
        }))

        setTimeout(() => {
          void get().refresh({ bypassCache: true })
        }, 500)

        return true
      } finally {
        set((state) => (state.pendingAmbassadorRequestId === ambassadorId ? { pendingAmbassadorRequestId: null } : {}))
      }
    },

    dismissBySource: (kind, sourceId) => {
      if (!sourceId) {
        return
      }

      set((state) => {
        const next = state.notifications.filter((item) => !(item.kind === kind && item.sourceEntityId === sourceId))
        const unreadCount = next.filter((item) => !item.readAt && !item.clearedAt).length
        return { notifications: next, unreadCount }
      })
    },
  }
})
