import { useCallback } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/retry'
import type { UserPostFeedItem } from '@/types/homeFeed'

interface ProfilePostsPage {
  items: UserPostFeedItem[]
  total: number
}

interface UseProfilePostsResult {
  items: UserPostFeedItem[]
  isLoading: boolean
  error: string | null
  total: number
  hasMore: boolean
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
  updateItemLike: (postId: string, liked: boolean, likeCount: number) => void
  removeItem: (feedItemId: string) => void
  prependItem: (item: UserPostFeedItem) => void
}

const DEFAULT_LIMIT = 20

function queryKey(profileId: string) {
  return ['profile-posts', profileId] as const
}

export function useProfilePosts(profileId: string): UseProfilePostsResult {
  const queryClient = useQueryClient()
  const key = queryKey(profileId)

  const query = useInfiniteQuery<ProfilePostsPage>({
    queryKey: key,
    enabled: !!profileId,
    initialPageParam: 0,
    // Refetch when web tab regains focus so multi-device sessions stay
    // in sync (mobile commits a post → web sees it on next focus).
    // See useHomeFeed.ts for the same rationale.
    refetchOnWindowFocus: true,
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0

      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('get_profile_posts', {
          p_profile_id: profileId,
          p_limit: DEFAULT_LIMIT,
          p_offset: offset,
        }),
        10_000
      )

      if (error) throw error

      const result = data as unknown as ProfilePostsPage
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
  const items = pages.flatMap(p => p.items)
  const total = pages[pages.length - 1]?.total ?? 0

  const refetch = useCallback(async () => {
    await query.refetch()
  }, [query])

  const loadMore = useCallback(async () => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      await query.fetchNextPage()
    }
  }, [query])

  const updateItemLike = useCallback((postId: string, liked: boolean, likeCount: number) => {
    queryClient.setQueryData<InfiniteData<ProfilePostsPage>>(key, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          items: page.items.map(item =>
            item.post_id === postId
              ? { ...item, has_liked: liked, like_count: likeCount }
              : item
          ),
        })),
      }
    })
  }, [queryClient, key])

  const removeItem = useCallback((feedItemId: string) => {
    queryClient.setQueryData<InfiniteData<ProfilePostsPage>>(key, (old) => {
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
  }, [queryClient, key])

  const prependItem = useCallback((item: UserPostFeedItem) => {
    queryClient.setQueryData<InfiniteData<ProfilePostsPage>>(key, (old) => {
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
  }, [queryClient, key])

  let errorStr: string | null = null
  if (query.error) {
    logger.error('[useProfilePosts] Error fetching posts:', query.error)
    errorStr = query.error instanceof Error ? query.error.message : 'Failed to load posts'
  }

  return {
    items,
    isLoading: query.isLoading,
    error: errorStr,
    total,
    hasMore: query.hasNextPage ?? false,
    refetch,
    loadMore,
    updateItemLike,
    removeItem,
    prependItem,
  }
}
