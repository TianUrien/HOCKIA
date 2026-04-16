/**
 * useBrands Hook
 *
 * React hook for fetching and managing brand listings.
 * Used on the Brands directory page for discovery.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export type BrandCategory =
  | 'equipment'
  | 'apparel'
  | 'accessories'
  | 'nutrition'
  | 'services'
  | 'technology'
  | 'other'

export interface Brand {
  id: string
  slug: string
  name: string
  logo_url: string | null
  bio: string | null
  category: BrandCategory
  website_url: string | null
  instagram_url: string | null
  is_verified: boolean
  created_at: string
  /** Most recent product or post date, falls back to created_at */
  last_activity_at: string
}

export interface BrandsQueryParams {
  category?: BrandCategory | null
  search?: string | null
  limit?: number
  offset?: number
}

interface UseBrandsResult {
  brands: Brand[]
  isLoading: boolean
  error: string | null
  total: number
  hasMore: boolean
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
}

const DEFAULT_LIMIT = 20

export function useBrands(params: BrandsQueryParams = {}): UseBrandsResult {
  const [brands, setBrands] = useState<Brand[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  const limit = params.limit ?? DEFAULT_LIMIT

  const fetchBrands = useCallback(async (reset = false) => {
    try {
      setIsLoading(true)
      setError(null)

      const currentOffset = reset ? 0 : offset

      const { data, error: rpcError } = await supabase.rpc('get_brands', {
        p_category: (params.category ?? null) as string | undefined,
        p_search: (params.search ?? null) as string | undefined,
        p_limit: limit,
        p_offset: currentOffset,
      })

      if (rpcError) {
        throw rpcError
      }

      const result = data as unknown as { brands: Brand[]; total: number }

      if (reset) {
        setBrands(result.brands)
        setOffset(limit)
      } else {
        setBrands(prev => [...prev, ...result.brands])
        setOffset(prev => prev + limit)
      }

      setTotal(result.total)
    } catch (err) {
      logger.error('[useBrands] Error fetching brands:', err)
      setError(err instanceof Error ? err.message : 'Failed to load brands')
    } finally {
      setIsLoading(false)
    }
  }, [params.category, params.search, limit, offset])

  const refetch = useCallback(async () => {
    setOffset(0)
    await fetchBrands(true)
  }, [fetchBrands])

  const loadMore = useCallback(async () => {
    if (!isLoading && brands.length < total) {
      await fetchBrands(false)
    }
  }, [fetchBrands, isLoading, brands.length, total])

  // Initial fetch and refetch when filters change
  useEffect(() => {
    setOffset(0)
    fetchBrands(true)
  }, [params.category, params.search]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    brands,
    isLoading,
    error,
    total,
    hasMore: brands.length < total,
    refetch,
    loadMore,
  }
}
