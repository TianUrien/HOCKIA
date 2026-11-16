/**
 * useBrandFeed Hook
 *
 * Fetches the unified global brand feed (products + posts) with pagination.
 * Used on the Brands page Global Feed tab.
 */

import { useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { ProductImage } from './useBrandProducts'
import { tBrands } from '@/i18n/ns/brands'

export interface FeedItemBase {
  id: string
  brand_id: string
  brand_name: string
  brand_slug: string
  brand_logo_url: string | null
  brand_category: string | null
  brand_is_verified: boolean
  created_at: string
}

export interface ProductFeedItem extends FeedItemBase {
  type: 'product'
  product_name: string
  product_description: string | null
  product_images: ProductImage[]
  product_external_url: string | null
}

export interface PostFeedItem extends FeedItemBase {
  type: 'post'
  post_content: string
  post_image_url: string | null
}

export type FeedItem = ProductFeedItem | PostFeedItem

interface FeedPage {
  items: FeedItem[]
  total: number
}

interface UseBrandFeedResult {
  items: FeedItem[]
  isLoading: boolean
  error: string | null
  total: number
  hasMore: boolean
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
}

const DEFAULT_LIMIT = 20
const QUERY_KEY = ['brand-feed'] as const

export function useBrandFeed(): UseBrandFeedResult {
  const query = useInfiniteQuery<FeedPage>({
    queryKey: QUERY_KEY,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0

       
      const { data, error } = await supabase.rpc('get_brand_feed', {
        p_limit: DEFAULT_LIMIT,
        p_offset: offset,
      })

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

  let errorStr: string | null = null
  if (query.error) {
    logger.error('[useBrandFeed] Error fetching feed:', query.error)
    errorStr = query.error instanceof Error ? query.error.message : tBrands('hookErrors.feedLoad')
  }

  return {
    items,
    isLoading: query.isLoading,
    error: errorStr,
    total,
    hasMore: query.hasNextPage ?? false,
    refetch,
    loadMore,
  }
}
