import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/retry'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import type { HomeFeedItem } from '@/types/homeFeed'

interface FeedPage {
  items: HomeFeedItem[]
  total: number
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
const QUERY_KEY = ['home-feed'] as const
const NEW_ITEMS_CHECK_COOLDOWN = 5_000 // minimum 5s between checks

export function useHomeFeed(): UseHomeFeedResult {
  const queryClient = useQueryClient()
  const { blockedIds } = useBlockedUsers()

  const query = useInfiniteQuery<FeedPage>({
    queryKey: QUERY_KEY,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0

      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('get_home_feed', {
          p_limit: DEFAULT_LIMIT,
          p_offset: offset,
        }),
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
  // Filter out blocked users' content instantly (Apple Guideline 1.2)
  const items = pages.flatMap(p => p.items).filter(
    item => !('author_id' in item && blockedIds.has(item.author_id as string))
  )
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
    } catch {
      // Silent fail — best-effort enhancement
    }
  }, [latestTimestamp])

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
    queryClient.setQueryData<InfiniteData<FeedPage>>(QUERY_KEY, (old) => {
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
  }, [queryClient])

  const removeItem = useCallback((feedItemId: string) => {
    queryClient.setQueryData<InfiniteData<FeedPage>>(QUERY_KEY, (old) => {
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
  }, [queryClient])

  const prependItem = useCallback((item: HomeFeedItem) => {
    setNewCount(0)
    queryClient.setQueryData<InfiniteData<FeedPage>>(QUERY_KEY, (old) => {
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
  }, [queryClient])

  // Map query error to string for backward compatibility
  let errorStr: string | null = null
  if (query.error) {
    logger.error('[useHomeFeed] Error fetching feed:', query.error)
    errorStr = query.error instanceof Error ? query.error.message : 'Failed to load feed'
  }

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
