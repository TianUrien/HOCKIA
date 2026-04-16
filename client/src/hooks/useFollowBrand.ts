import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface FollowResult {
  success: boolean
  followed: boolean
  follower_count: number
}

export function useFollowBrand(brandId: string | undefined) {
  const [isFollowing, setIsFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  // Check initial follow status
  useEffect(() => {
    if (!brandId) return

    let cancelled = false
    setIsLoading(true)

    const check = async () => {
      try {
         
        const { data, error } = await supabase.rpc('check_brand_follow_status', {
          p_brand_id: brandId,
        })

        if (error) throw error
        if (cancelled) return

        const status = data as unknown as { is_following: boolean; follower_count: number }
        setIsFollowing(status.is_following)
        setFollowerCount(status.follower_count)
      } catch (err) {
        logger.error('[useFollowBrand] check status error:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    check()
    return () => { cancelled = true }
  }, [brandId])

  const toggleFollow = useCallback(async () => {
    if (!brandId || isToggling) return

    setIsToggling(true)

    // Optimistic update
    const wasFollowing = isFollowing
    const prevCount = followerCount
    setIsFollowing(!wasFollowing)
    setFollowerCount(wasFollowing ? Math.max(prevCount - 1, 0) : prevCount + 1)

    try {
      const rpcName = wasFollowing ? 'unfollow_brand' : 'follow_brand'
       
      const { data, error } = await supabase.rpc(rpcName, {
        p_brand_id: brandId,
      })

      if (error) throw error

      const result = data as unknown as FollowResult
      if (result.success) {
        setIsFollowing(result.followed)
        setFollowerCount(result.follower_count)
      } else {
        // Revert optimistic update
        setIsFollowing(wasFollowing)
        setFollowerCount(prevCount)
      }
    } catch (err) {
      logger.error('[useFollowBrand] toggle error:', err)
      // Revert optimistic update
      setIsFollowing(wasFollowing)
      setFollowerCount(prevCount)
    } finally {
      setIsToggling(false)
    }
  }, [brandId, isFollowing, followerCount, isToggling])

  return { isFollowing, followerCount, toggleFollow, isLoading, isToggling }
}
