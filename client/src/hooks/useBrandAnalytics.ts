import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface BrandAnalytics {
  profile_views: number
  profile_views_previous: number
  follower_count: number
  product_count: number
  post_count: number
  ambassador_count: number
}

export function useBrandAnalytics(days: number = 30) {
  const [analytics, setAnalytics] = useState<BrandAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchAnalytics = useCallback(async () => {
    try {
      setIsLoading(true)
       
      const { data, error } = await supabase.rpc('get_my_brand_analytics', {
        p_days: days,
      })

      if (error) throw error

      const result = data as unknown as BrandAnalytics & { success: boolean }
      if (result.success) {
        setAnalytics({
          profile_views: result.profile_views,
          profile_views_previous: result.profile_views_previous,
          follower_count: result.follower_count,
          product_count: result.product_count,
          post_count: result.post_count,
          ambassador_count: result.ambassador_count,
        })
      }
    } catch (err) {
      logger.error('[useBrandAnalytics] error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [days])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  return { analytics, isLoading, refetch: fetchAnalytics }
}
