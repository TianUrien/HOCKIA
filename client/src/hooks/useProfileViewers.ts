import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface ProfileViewer {
  viewer_id: string
  full_name: string | null
  role: string
  username: string | null
  avatar_url: string | null
  base_location: string | null
  brand_slug: string | null
  viewed_at: string
  view_count: number
}

export interface ProfileViewStats {
  total_views: number
  unique_viewers: number
  previous_total_views: number
  previous_unique_viewers: number
  anonymous_viewers: number
}

export function useProfileViewers(days: number = 30, limit: number = 20) {
  const [viewers, setViewers] = useState<ProfileViewer[]>([])
  const [stats, setStats] = useState<ProfileViewStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)

      const [viewersRes, statsRes] = await Promise.all([
        supabase.rpc('get_my_profile_viewers', { p_days: days, p_limit: limit }),
        supabase.rpc('get_my_profile_view_stats', { p_days: days }),
      ])

      if (viewersRes.error) throw viewersRes.error
      if (statsRes.error) throw statsRes.error

      setViewers((viewersRes.data as ProfileViewer[]) || [])

      const statsData = statsRes.data as unknown as ProfileViewStats & { success: boolean }
      if (statsData.success) {
        setStats({
          total_views: statsData.total_views,
          unique_viewers: statsData.unique_viewers,
          previous_total_views: statsData.previous_total_views,
          previous_unique_viewers: statsData.previous_unique_viewers,
          anonymous_viewers: statsData.anonymous_viewers,
        })
      }
    } catch (err) {
      logger.error('[useProfileViewers] error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [days, limit])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { viewers, stats, isLoading, refetch: fetchData }
}
