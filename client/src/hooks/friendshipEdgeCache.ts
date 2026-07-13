import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import { reportSupabaseError } from '@/lib/sentryHelpers'

export type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']

// ── Shared friendship-edge cache ─────────────────────────────────────────
// The community grid mounts one useFriendship per candidate card; fetching
// one edge per card was a real N+1 (Sentry AG: 252 events / 21 users on
// /community). A viewer's OWN edges are a small set and RLS lets them read
// all of them in one query — so fetch once per viewer, index by friend_id,
// and share across every mounted hook.
//
// Lives in its own module (not useFriendship.ts) so non-hook mutators —
// the notifications panel, FriendsTab, ConnectionsSection — can call
// invalidateFriendshipEdges() without an import cycle through lib/
// notifications. Same split as useBlockedUsers/notifyBlockListChanged.
let edgeCacheViewer: string | null = null
let edgeCache: Map<string, FriendEdge> | null = null
let edgeInflight: Promise<void> | null = null
let edgeFetchFailed = false
// Bumped by every new fetch and every reset: an in-flight fetch whose
// generation is stale was superseded (force refetch, viewer switch) and
// must discard its result instead of overwriting newer data.
let edgeGeneration = 0
const edgeListeners = new Set<() => void>()

function notifyEdgeListeners(): void {
  for (const l of edgeListeners) l()
}

function resetEdgeCache(): void {
  edgeCacheViewer = null
  edgeCache = null
  edgeInflight = null
  edgeFetchFailed = false
  edgeGeneration++
}

export function subscribeFriendshipEdges(listener: () => void): () => void {
  edgeListeners.add(listener)
  return () => {
    edgeListeners.delete(listener)
  }
}

export function getFriendshipEdgeState(viewerId: string | undefined): {
  ready: boolean
  edges: Map<string, FriendEdge> | null
} {
  if (!viewerId || edgeCacheViewer !== viewerId) return { ready: false, edges: null }
  // A failed fetch still counts as "ready" so `loading` terminates, but the
  // cache stays cold (edges null) — the next mount retries instead of the
  // whole session silently rendering every friend as a stranger.
  return { ready: edgeCache !== null || edgeFetchFailed, edges: edgeCache }
}

export async function loadFriendshipEdges(viewerId: string, force = false): Promise<void> {
  // Claim the viewer BEFORE any inflight check: otherwise every concurrent
  // mount sees a viewer mismatch, resets the cache (wiping the inflight
  // promise) and starts its own fetch — the exact N+1 this exists to kill
  // (pinned by useFriendshipBatch.test).
  if (edgeCacheViewer !== viewerId) {
    resetEdgeCache()
    edgeCacheViewer = viewerId
  }
  if (edgeCache && !force) return
  if (edgeInflight && !force) return edgeInflight

  const generation = ++edgeGeneration
  let run: Promise<void> | null = null
  run = (async () => {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'friendships.fetch_edges',
      data: { viewerId },
      level: 'info',
    })
    const { data, error } = await supabase
      .from('profile_friend_edges')
      .select('*')
      .eq('profile_id', viewerId)
    if (generation !== edgeGeneration || edgeCacheViewer !== viewerId) return // superseded — discard
    if (error) {
      logger.error('Failed to fetch friendship edges', error)
      reportSupabaseError('friends.fetch_state', error, { viewerId }, {
        feature: 'friends',
        operation: 'fetch_friendship',
      })
      edgeFetchFailed = true
    } else {
      const map = new Map<string, FriendEdge>()
      for (const row of (data ?? []) as FriendEdge[]) {
        if (row.friend_id) map.set(row.friend_id, row)
      }
      edgeCache = map
      edgeFetchFailed = false
    }
    if (edgeInflight === run) edgeInflight = null
    notifyEdgeListeners()
  })()
  edgeInflight = run
  return run
}

/**
 * Call after ANY write to profile_friendships made outside useFriendship —
 * the notifications panel accept/decline, FriendsTab, ConnectionsSection.
 * Refetches the warm cache so every mounted card converges on the new
 * state; no-op if nothing was ever loaded.
 */
export function invalidateFriendshipEdges(): void {
  if (edgeCacheViewer) void loadFriendshipEdges(edgeCacheViewer, true)
}

/** Test-only: clear module state between specs. */
export function resetFriendshipEdgeCacheForTests(): void {
  resetEdgeCache()
}
