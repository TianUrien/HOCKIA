import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/retry'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import type { HomeFeedItem } from '@/types/homeFeed'

interface FeedPage {
  items: HomeFeedItem[]
  total: number
}

export interface UseHomeFeedFilters {
  countryIds?: number[]
  roles?: string[]
}

interface UseHomeFeedResult {
  items: HomeFeedItem[]
  isLoading: boolean
  isFetchingNextPage: boolean
  error: string | null
  total: number
  hasMore: boolean
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
  updateItemLike: (postId: string, liked: boolean, likeCount: number) => void
  removeItem: (feedItemId: string) => void
  prependItem: (item: HomeFeedItem) => void
  newCount: number
  showNewItems: () => Promise<void>
  dismissNewItems: () => void
}

const DEFAULT_LIMIT = 20
const NEW_ITEMS_CHECK_COOLDOWN = 5_000 // minimum 5s between checks

// Stable serialization of filter selections for react-query keys. Sorting
// avoids cache misses when callers pass the same selection in different orders.
function stableFilterKey(filters: UseHomeFeedFilters | undefined): string {
  if (!filters) return ''
  const countryIds = (filters.countryIds ?? []).slice().sort((a, b) => a - b).join(',')
  const roles = (filters.roles ?? []).slice().sort().join(',')
  return `c:${countryIds}|r:${roles}`
}

export function useHomeFeed(filters?: UseHomeFeedFilters): UseHomeFeedResult {
  const queryClient = useQueryClient()
  const { blockedIds } = useBlockedUsers()

  const filterKey = stableFilterKey(filters)
  const queryKey = useMemo(() => ['home-feed', filterKey] as const, [filterKey])

  // Empty arrays are equivalent to "no filter" — pass through only when an
  // actual selection exists. Omitting the new params entirely keeps callers
  // backward-compatible with versions of get_home_feed that don't yet have
  // the country/role parameters (i.e. environments where the
  // 20260425010000_home_feed_author_filters migration hasn't been applied).
  //
  // Memoize on the stable filterKey so subsequent renders of useHomeFeed
  // (e.g. via parent re-renders unrelated to filters) don't allocate fresh
  // array refs that would re-fire the Sentry error effect downstream.
  const rpcCountryIds = useMemo(
    () => (filters?.countryIds && filters.countryIds.length > 0 ? filters.countryIds : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the canonical dep
    [filterKey]
  )
  const rpcRoles = useMemo(
    () => (filters?.roles && filters.roles.length > 0 ? filters.roles : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the canonical dep
    [filterKey]
  )
  const hasFilters = rpcCountryIds !== null || rpcRoles !== null

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    initialPageParam: 0,
    // Multi-device drift: same user has the app open on web + mobile,
    // commits a comment on mobile → mobile invalidates its TanStack
    // cache; web's instance never hears about it. Refetching on window
    // focus closes the gap when the user comes back to web. Global
    // queryClient default is `false` (too aggressive for non-feed
    // queries); enabling it per-feed keeps the rest of the app quiet.
    refetchOnWindowFocus: true,
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0

      const rpcParams: Record<string, unknown> = {
        p_limit: DEFAULT_LIMIT,
        p_offset: offset,
      }
      if (hasFilters) {
        rpcParams.p_country_ids = rpcCountryIds
        rpcParams.p_roles = rpcRoles
      }

      const { data, error } = await withTimeout(

        async () => await supabase.rpc('get_home_feed', rpcParams),
        10_000
      )

      if (error) throw error

      const result = data as unknown as FeedPage
      return {
        items: Array.isArray(result.items) ? result.items : [],
        total: result.total ?? 0,
      }
    },
    getNextPageParam: (_lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      const total = allPages[allPages.length - 1]?.total ?? 0
      return loaded < total ? loaded : undefined
    },
  })

  const pages = query.data?.pages ?? []
  // Filter out blocked users' content instantly (Apple Guideline 1.2).
  // Different item types carry the author identity in different fields:
  //   user_post / transfer / signing → author_id
  //   member_joined / milestone / reference_received → profile_id
  //   opportunity_posted → club_id (the club is the publisher)
  //   reference_received also has referee_id (we hide if EITHER party is blocked)
  // Brand posts / products carry brand_id (a brand UUID, not the owning
  // user's profile id), so we can't filter them client-side without an
  // RPC change to expose the brand's owning profile_id. Server-side
  // filtering via the new author_profile_id column is the longer-term fix.
  const items = pages.flatMap(p => p.items).filter(item => {
    const candidateIds: string[] = []
    if ('author_id' in item && typeof item.author_id === 'string') candidateIds.push(item.author_id)
    if ('profile_id' in item && typeof item.profile_id === 'string') candidateIds.push(item.profile_id)
    if ('club_id' in item && typeof item.club_id === 'string') candidateIds.push(item.club_id)
    if ('referee_id' in item && typeof item.referee_id === 'string') candidateIds.push(item.referee_id)
    return !candidateIds.some(id => blockedIds.has(id))
  })
  const total = pages[pages.length - 1]?.total ?? 0

  // --- New items detection ---
  const [newCount, setNewCount] = useState(0)
  const lastCheckRef = useRef(0)

  const latestTimestamp = useMemo(() => {
    if (items.length === 0) return null
    return items[0].created_at // items are sorted newest-first from the RPC
  }, [items])

  const checkForNewItems = useCallback(async () => {
    if (!latestTimestamp) return
    // get_home_feed_new_count doesn't take filter args — under an active
    // filter, it would surface counts for items the filtered feed will then
    // drop, leading to "1 new post" → tap → 0 visible items. Suppress the
    // check entirely while filters are active. Returning to the global
    // feed will resume normal behavior.
    if (hasFilters) return
    const now = Date.now()
    if (now - lastCheckRef.current < NEW_ITEMS_CHECK_COOLDOWN) return
    lastCheckRef.current = now

    try {

      const { data, error } = await supabase.rpc('get_home_feed_new_count', {
        p_since: latestTimestamp,
      })
      if (!error && typeof data === 'number' && data > 0) {
        setNewCount(data)
      }
    } catch (err) {
      // Best-effort: don't surface to user, but breadcrumb so persistent
      // failures show up in Sentry trails preceding any other error.
      Sentry.addBreadcrumb({
        category: 'home_feed',
        level: 'warning',
        message: 'new_count_check_failed',
        data: { error: String(err) },
      })
    }
  }, [latestTimestamp, hasFilters])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkForNewItems()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [checkForNewItems])

  const showNewItems = useCallback(async () => {
    setNewCount(0)
    await query.refetch()
  }, [query])

  const dismissNewItems = useCallback(() => {
    setNewCount(0)
  }, [])

  const refetch = useCallback(async () => {
    setNewCount(0)
    await query.refetch()
  }, [query])

  const loadMore = useCallback(async () => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      await query.fetchNextPage()
    }
  }, [query])

  const updateItemLike = useCallback((postId: string, liked: boolean, likeCount: number) => {
    queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          items: page.items.map(item =>
            item.item_type === 'user_post' && item.post_id === postId
              ? { ...item, has_liked: liked, like_count: likeCount }
              : item
          ),
        })),
      }
    })
  }, [queryClient, queryKey])

  const removeItem = useCallback((feedItemId: string) => {
    queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          items: page.items.filter(item => item.feed_item_id !== feedItemId),
          total: Math.max(0, page.total - 1),
        })),
      }
    })
  }, [queryClient, queryKey])

  const prependItem = useCallback((item: HomeFeedItem) => {
    setNewCount(0)
    queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (old) => {
      if (!old || old.pages.length === 0) return old
      const [firstPage, ...rest] = old.pages
      return {
        ...old,
        pages: [
          { items: [item, ...firstPage.items], total: firstPage.total + 1 },
          ...rest.map(p => ({ ...p, total: p.total + 1 })),
        ],
      }
    })
  }, [queryClient, queryKey])

  // Map query error to string for backward compatibility
  let errorStr: string | null = null
  if (query.error) {
    logger.error('[useHomeFeed] Error fetching feed:', query.error)
    errorStr = query.error instanceof Error ? query.error.message : 'Failed to load feed'
  }

  // Report RPC failures to Sentry once per error (deduped via the query
  // object identity). This is what would have caught the PGRST203 overload
  // mismatch we hit during the migration push — those today only surface
  // in the user's console.
  const reportedErrorRef = useRef<unknown>(null)
  useEffect(() => {
    if (!query.error || reportedErrorRef.current === query.error) return
    reportedErrorRef.current = query.error
    reportSupabaseError(
      'home_feed.rpc',
      query.error,
      {
        countryIds: rpcCountryIds,
        roles: rpcRoles,
        hasFilters,
        pagesLoaded: pages.length,
      },
      { feature: 'home_feed', rpc: 'get_home_feed' }
    )
  }, [query.error, rpcCountryIds, rpcRoles, hasFilters, pages.length])

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    error: errorStr,
    total,
    hasMore: query.hasNextPage ?? false,
    refetch,
    loadMore,
    updateItemLike,
    removeItem,
    prependItem,
    newCount,
    showNewItems,
    dismissNewItems,
  }
}
