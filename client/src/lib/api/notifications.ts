import { supabase } from '@/lib/supabase'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import type { Database, Json } from '@/lib/database.types'

export type NotificationKind = Database['public']['Enums']['profile_notification_kind']
export type NotificationFilter = 'all' | 'unread' | 'by_type'
export type NotificationMetadata = Record<string, Json>

export type NotificationActor = {
  id: string | null
  fullName: string | null
  role: string | null
  username: string | null
  avatarUrl: string | null
  baseLocation: string | null
}

export type NotificationRecord = {
  id: string
  kind: NotificationKind
  sourceEntityId: string | null
  metadata: NotificationMetadata
  targetUrl: string | null
  createdAt: string
  readAt: string | null
  seenAt: string | null
  clearedAt: string | null
  actor: NotificationActor
}

export type NotificationCounts = {
  unreadCount: number
  totalCount: number
}

type GetNotificationsParams = {
  filter?: NotificationFilter
  kind?: NotificationKind
  limit?: number
  offset?: number
}

type RpcNotificationRow = {
  id: string
  kind: NotificationKind
  source_entity_id: string | null
  metadata: NotificationMetadata | null
  target_url: string | null
  created_at: string
  read_at: string | null
  seen_at: string | null
  cleared_at: string | null
  actor: {
    id?: string | null
    full_name?: string | null
    role?: string | null
    username?: string | null
    avatar_url?: string | null
    base_location?: string | null
  } | null
}

const normalizeNotification = (row: RpcNotificationRow): NotificationRecord => ({
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
    id: row.actor?.id ?? null,
    fullName: row.actor?.full_name ?? null,
    role: row.actor?.role ?? null,
    username: row.actor?.username ?? null,
    avatarUrl: row.actor?.avatar_url ?? null,
    baseLocation: row.actor?.base_location ?? null,
  },
})

export const fetchNotificationsPage = async (
  params: GetNotificationsParams = {}
): Promise<NotificationRecord[]> => {
  const filter = params.filter ?? 'all'
  const limit = params.limit ?? 30
  const offset = params.offset ?? 0

  const rows = await monitor.measure('notifications:get_page', async () => {
    const { data, error } = await supabase.rpc('get_notifications', {
      p_filter: filter,
      p_kind: params.kind ?? undefined,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      logger.error('[NOTIFICATIONS] Failed to fetch notifications', error)
      throw error
    }

    return (data ?? []) as unknown as RpcNotificationRow[]
  }, {
    filter,
    kind: params.kind ?? 'any',
    limit: limit.toString(),
    offset: offset.toString(),
  })

  // Fire-and-forget seen_at stamp. The previous get_notifications RPC ran
  // this UPDATE inline, which caused row-lock contention under concurrent
  // reads for the same user (tail latency spiked to 20s in production
  // telemetry). Splitting the write off the read returns immediately and
  // lets the seen_at timestamp land moments later without blocking anyone.
  //
  // Migration 20260525024500 added the mark_notifications_seen RPC. The
  // `as never` cast keeps TypeScript happy until the generated
  // database.types.ts is regenerated post-deploy — the runtime call is
  // valid as soon as the migration applies. PromiseLike → Promise via
  // Promise.resolve so we can attach .then/.catch consistently.
  const unseenIds = rows
    .filter(r => r.seen_at === null)
    .map(r => r.id)
  if (unseenIds.length > 0) {
    void Promise.resolve(
      supabase.rpc('mark_notifications_seen' as never, { p_ids: unseenIds } as never)
    )
      .then((res) => {
        const err = (res as { error?: unknown }).error
        if (err) logger.warn('[NOTIFICATIONS] mark_notifications_seen failed', err)
      })
      .catch((err: unknown) => logger.warn('[NOTIFICATIONS] mark_notifications_seen threw', err))
  }

  return rows.map(normalizeNotification)
}

export const fetchNotificationCounts = async (): Promise<NotificationCounts> => {
  return await monitor.measure('notifications:get_counts', async () => {
    const { data, error } = await supabase.rpc('get_notification_counts')

    if (error) {
      logger.error('[NOTIFICATIONS] Failed to fetch notification counts', error)
      throw error
    }

    const row = data?.[0]
    return {
      unreadCount: Number(row?.unread_count ?? 0),
      totalCount: Number(row?.total_count ?? 0),
    }
  })
}

export const markNotificationRead = async (notificationId: string): Promise<boolean> => {
  return await monitor.measure('notifications:mark_read', async () => {
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    })

    if (error) {
      logger.error('[NOTIFICATIONS] Failed to mark notification read', error)
      throw error
    }

    return Boolean(data)
  }, { notificationId })
}

export const markAllNotificationsRead = async (kind?: NotificationKind): Promise<number> => {
  return await monitor.measure('notifications:mark_all_read', async () => {
    const { data, error } = await supabase.rpc('mark_all_notifications_read', {
      p_kind: kind ?? undefined,
    })

    if (error) {
      logger.error('[NOTIFICATIONS] Failed to mark all notifications read', error)
      throw error
    }

    return Number(data ?? 0)
  }, { kind: kind ?? 'all' })
}

export const clearNotifications = async (params?: {
  notificationIds?: string[]
  kind?: NotificationKind
}): Promise<number> => {
  return await monitor.measure('notifications:clear', async () => {
    const { data, error } = await supabase.rpc('clear_profile_notifications', {
      p_notification_ids: params?.notificationIds ?? undefined,
      p_kind: params?.kind ?? undefined,
    })

    if (error) {
      logger.error('[NOTIFICATIONS] Failed to clear notifications', error)
      throw error
    }

    return Number(data ?? 0)
  }, {
    kind: params?.kind ?? 'any',
    notificationIds: params?.notificationIds?.length ? params.notificationIds.length.toString() : 'none',
  })
}
