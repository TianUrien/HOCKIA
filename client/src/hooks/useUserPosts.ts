import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/retry'

export interface PostImage {
  url: string
  thumb_url?: string | null
  media_type?: 'image' | 'video'
  width?: number | null
  height?: number | null
  duration?: number | null
  order: number
}

interface PostResult {
  success: boolean
  post_id?: string
  error?: string
}

interface SimpleResult {
  success: boolean
  error?: string
}

export function useUserPosts() {
  const createPost = useCallback(async (
    content: string,
    images?: PostImage[] | null
  ): Promise<PostResult> => {
    try {
      const { data, error } = await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => await (supabase.rpc as any)('create_user_post', {
          p_content: content,
          p_images: images && images.length > 0 ? images : null,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      return result
    } catch (err) {
      logger.error('[useUserPosts] createPost error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create post',
      }
    }
  }, [])

  const updatePost = useCallback(async (
    postId: string,
    content: string,
    images?: PostImage[] | null
  ): Promise<SimpleResult> => {
    try {
      const { data, error } = await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => await (supabase.rpc as any)('update_user_post', {
          p_post_id: postId,
          p_content: content,
          p_images: images && images.length > 0 ? images : null,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as SimpleResult
      return result
    } catch (err) {
      logger.error('[useUserPosts] updatePost error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update post',
      }
    }
  }, [])

  const deletePost = useCallback(async (postId: string): Promise<SimpleResult> => {
    try {
      const { data, error } = await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => await (supabase.rpc as any)('delete_user_post', {
          p_post_id: postId,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as SimpleResult
      return result
    } catch (err) {
      logger.error('[useUserPosts] deletePost error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete post',
      }
    }
  }, [])

  const createTransferPost = useCallback(async (
    clubName: string,
    clubCountryId: number | null,
    worldClubId: string | null,
    clubAvatarUrl: string | null,
    content?: string | null,
    images?: PostImage[] | null
  ): Promise<PostResult> => {
    try {
      const { data, error } = await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => await (supabase.rpc as any)('create_transfer_post', {
          p_club_name: clubName,
          p_club_country_id: clubCountryId,
          p_world_club_id: worldClubId,
          p_club_avatar_url: clubAvatarUrl,
          p_content: content || null,
          p_images: images && images.length > 0 ? images : null,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      return result
    } catch (err) {
      logger.error('[useUserPosts] createTransferPost error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create transfer post',
      }
    }
  }, [])

  const createSigningPost = useCallback(async (
    personProfileId: string,
    content?: string | null,
    images?: PostImage[] | null
  ): Promise<PostResult> => {
    try {
      const { data, error } = await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => await (supabase.rpc as any)('create_signing_post', {
          p_person_profile_id: personProfileId,
          p_content: content || null,
          p_images: images && images.length > 0 ? images : null,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      return result
    } catch (err) {
      logger.error('[useUserPosts] createSigningPost error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create signing post',
      }
    }
  }, [])

  return { createPost, createTransferPost, createSigningPost, updatePost, deletePost }
}
