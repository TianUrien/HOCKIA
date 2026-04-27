import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { withTimeout } from '@/lib/retry'
import { trackDbEvent } from '@/lib/trackDbEvent'

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
  const queryClient = useQueryClient()

  // Both Home (`['home-feed', filterKey]`) and Dashboard
  // (`['profile-posts', profileId]`) render user_posts from independent
  // caches. A mutation on one surface used to leave the other showing
  // stale state until the user manually refreshed. Invalidating both
  // here triggers a background refetch on the other surface; the firing
  // surface's optimistic update (prependItem / removeItem / updateItemLike)
  // keeps the immediate UX snappy while the refetch reconciles.
  const invalidatePostQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home-feed'] })
    queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
  }, [queryClient])

  // Create-only invalidator — skips home-feed because:
  //   1. The caller already prepended the new item via prependItemRef
  //      (HomePage wires it through onPostCreated)
  //   2. If filters are active and the new post doesn't match (e.g.
  //      user is a player from AR but filter is "Netherlands only"),
  //      a refetch would return 0 matching items and TanStack would
  //      replace the cached pages — the optimistic prepend disappears.
  //      User sees their post for ~1s then it vanishes — looks like
  //      the post failed even though the server committed it.
  // Dashboard is the canonical "my posts" surface and always shows
  // the user's own posts regardless of filters, so it still invalidates.
  const invalidatePostQueriesAfterCreate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
  }, [queryClient])

  const createPost = useCallback(async (
    content: string,
    images?: PostImage[] | null
  ): Promise<PostResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('create_user_post', {
          p_content: content,
          p_images: (images && images.length > 0 ? images : null) as unknown as undefined,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      if (result.success && result.post_id) {
        trackDbEvent('post_create', 'post', result.post_id, { type: 'user' })
        invalidatePostQueriesAfterCreate()
      }
      return result
    } catch (err) {
      logger.error('[useUserPosts] createPost error:', err)
      reportSupabaseError('useUserPosts.createPost', err, {
        hasContent: content.length > 0,
        mediaCount: images?.length ?? 0,
      }, { feature: 'user_posts', op: 'create' })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create post',
      }
    }
  }, [invalidatePostQueriesAfterCreate])

  const updatePost = useCallback(async (
    postId: string,
    content: string,
    images?: PostImage[] | null
  ): Promise<SimpleResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('update_user_post', {
          p_post_id: postId,
          p_content: content,
          p_images: (images && images.length > 0 ? images : null) as unknown as undefined,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as SimpleResult
      if (result.success) {
        invalidatePostQueries()
      }
      return result
    } catch (err) {
      logger.error('[useUserPosts] updatePost error:', err)
      reportSupabaseError('useUserPosts.updatePost', err, {
        hasContent: content.length > 0,
        mediaCount: images?.length ?? 0,
      }, { feature: 'user_posts', op: 'update' })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update post',
      }
    }
  }, [invalidatePostQueries])

  const deletePost = useCallback(async (postId: string): Promise<SimpleResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('delete_user_post', {
          p_post_id: postId,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as SimpleResult
      if (result.success) {
        trackDbEvent('post_delete', 'post', postId, { type: 'user' })
        invalidatePostQueries()
      }
      return result
    } catch (err) {
      logger.error('[useUserPosts] deletePost error:', err)
      reportSupabaseError('useUserPosts.deletePost', err, {}, {
        feature: 'user_posts', op: 'delete',
      })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete post',
      }
    }
  }, [invalidatePostQueries])

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
         
        async () => await supabase.rpc('create_transfer_post', {
          p_club_name: clubName,
          p_club_country_id: (clubCountryId ?? undefined) as number | undefined,
          p_world_club_id: (worldClubId ?? undefined) as string | undefined,
          p_club_avatar_url: (clubAvatarUrl ?? undefined) as string | undefined,
          p_content: (content || null) as string | undefined,
          p_images: (images && images.length > 0 ? images : null) as unknown as undefined,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      if (result.success && result.post_id) {
        trackDbEvent('post_create', 'post', result.post_id, { type: 'transfer' })
        invalidatePostQueriesAfterCreate()
      }
      return result
    } catch (err) {
      logger.error('[useUserPosts] createTransferPost error:', err)
      reportSupabaseError('useUserPosts.createTransferPost', err, {
        hasWorldClubId: Boolean(worldClubId),
        hasContent: Boolean(content),
        mediaCount: images?.length ?? 0,
      }, { feature: 'user_posts', op: 'create_transfer' })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create transfer post',
      }
    }
  }, [invalidatePostQueriesAfterCreate])

  const createSigningPost = useCallback(async (
    personProfileId: string,
    content?: string | null,
    images?: PostImage[] | null
  ): Promise<PostResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('create_signing_post', {
          p_person_profile_id: personProfileId,
          p_content: (content || null) as string | undefined,
          p_images: (images && images.length > 0 ? images : null) as unknown as undefined,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as PostResult
      if (result.success && result.post_id) {
        trackDbEvent('post_create', 'post', result.post_id, { type: 'signing' })
        invalidatePostQueriesAfterCreate()
      }
      return result
    } catch (err) {
      logger.error('[useUserPosts] createSigningPost error:', err)
      reportSupabaseError('useUserPosts.createSigningPost', err, {
        hasContent: Boolean(content),
        mediaCount: images?.length ?? 0,
      }, { feature: 'user_posts', op: 'create_signing' })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create signing post',
      }
    }
  }, [invalidatePostQueriesAfterCreate])

  return { createPost, createTransferPost, createSigningPost, updatePost, deletePost }
}
