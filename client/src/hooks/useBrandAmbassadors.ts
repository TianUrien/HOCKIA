import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface BrandAmbassador {
  id: string
  player_id: string
  full_name: string | null
  avatar_url: string | null
  role: string
  position: string | null
  base_location: string | null
  current_club: string | null
  status: 'pending' | 'accepted' | 'declined'
  added_at: string
  responded_at: string | null
}

const PAGE_SIZE = 20

export function useBrandAmbassadors(brandId: string | null | undefined) {
  const [ambassadors, setAmbassadors] = useState<BrandAmbassador[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  const fetchAmbassadors = useCallback(async (fetchOffset: number = 0, append: boolean = false) => {
    if (!brandId) {
      setAmbassadors([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    try {
      if (!append) setIsLoading(true)
      setError(null)

       
      const { data, error: rpcError } = await supabase.rpc('get_brand_ambassadors', {
        p_brand_id: brandId,
        p_limit: PAGE_SIZE,
        p_offset: fetchOffset,
      })

      if (rpcError) throw rpcError

      const result = data as unknown as { ambassadors: BrandAmbassador[]; total: number }
      setAmbassadors(prev => append ? [...prev, ...result.ambassadors] : result.ambassadors)
      setTotal(result.total)
    } catch (err) {
      logger.error('[useBrandAmbassadors] Error fetching:', err)
      setError(err instanceof Error ? err.message : 'Failed to load ambassadors')
    } finally {
      setIsLoading(false)
    }
  }, [brandId])

  const addAmbassador = useCallback(async (playerId: string) => {
    if (!brandId) return { success: false, error: 'No brand ID' }

    try {
       
      const { data, error: rpcError } = await supabase.rpc('add_brand_ambassador', {
        p_brand_id: brandId,
        p_player_id: playerId,
      })

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string; ambassador_count?: number }
      if (!result.success) return { success: false, error: result.error }

      // Refetch list
      setOffset(0)
      await fetchAmbassadors(0, false)

      return { success: true }
    } catch (err) {
      logger.error('[useBrandAmbassadors] Error adding:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add ambassador' }
    }
  }, [brandId, fetchAmbassadors])

  const removeAmbassador = useCallback(async (playerId: string) => {
    if (!brandId) return { success: false, error: 'No brand ID' }

    try {
       
      const { data, error: rpcError } = await supabase.rpc('remove_brand_ambassador', {
        p_brand_id: brandId,
        p_player_id: playerId,
      })

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string }
      if (!result.success) return { success: false, error: result.error }

      // Optimistic remove from local state
      setAmbassadors(prev => prev.filter(a => a.player_id !== playerId))
      setTotal(prev => Math.max(prev - 1, 0))

      return { success: true }
    } catch (err) {
      logger.error('[useBrandAmbassadors] Error removing:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove ambassador' }
    }
  }, [brandId])

  const loadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    fetchAmbassadors(nextOffset, true)
  }, [offset, fetchAmbassadors])

  useEffect(() => {
    setOffset(0)
    void fetchAmbassadors(0, false)
  }, [fetchAmbassadors])

  return {
    ambassadors,
    total,
    isLoading,
    error,
    addAmbassador,
    removeAmbassador,
    loadMore,
    hasMore: ambassadors.length < total,
    refetch: () => fetchAmbassadors(0, false),
  }
}
