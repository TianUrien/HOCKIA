import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { withTimeout } from '@/lib/retry'
import { trackDbEvent } from '@/lib/trackDbEvent'
import type { PostComment } from '@/types/homeFeed'

interface LikeResult {
  success: boolean
  liked?: boolean
  like_count?: number
  error?: string
}

interface CommentsResult {
  comments: PostComment[]
  total: number
}

interface CommentCreateResult {
  success: boolean
  comment_id?: string
  error?: string
}

interface SimpleResult {
  success: boolean
  error?: string
}

export function usePostInteractions() {
  const queryClient = useQueryClient()

  // Home (`['home-feed', filterKey]`) and Dashboard (`['profile-posts',
  // profileId]`) render user_posts from independent caches. Likes and
  // comments fired on one surface used to leave the other showing stale
  // counts until manual refresh. Invalidating both keeps them in sync.
  const invalidatePostQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home-feed'] })
    queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
  }, [queryClient])

  const toggleLike = useCallback(async (postId: string): Promise<LikeResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('toggle_post_like', {
          p_post_id: postId,
        }),
        10_000
      )

      if (error) throw error

      const result = data as unknown as LikeResult
      if (result.success) {
        trackDbEvent('post_like', 'post', postId, { liked: result.liked })
        invalidatePostQueries()
      }
      return result
    } catch (err) {
      logger.error('[usePostInteractions] toggleLike error:', err)
      reportSupabaseError('usePostInteractions.toggleLike', err, {}, {
        feature: 'post_interactions', op: 'toggle_like',
      })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to toggle like',
      }
    }
  }, [invalidatePostQueries])

  const fetchComments = useCallback(async (
    postId: string,
    limit = 20,
    offset = 0
  ): Promise<CommentsResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('get_post_comments', {
          p_post_id: postId,
          p_limit: limit,
          p_offset: offset,
        }),
        10_000
      )

      if (error) throw error

      const result = data as unknown as CommentsResult
      return {
        comments: Array.isArray(result.comments) ? result.comments : [],
        total: result.total ?? 0,
      }
    } catch (err) {
      logger.error('[usePostInteractions] fetchComments error:', err)
      return { comments: [], total: 0 }
    }
  }, [])

  const createComment = useCallback(async (
    postId: string,
    content: string
  ): Promise<CommentCreateResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('create_post_comment', {
          p_post_id: postId,
          p_content: content,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as CommentCreateResult
      if (result.success) {
        trackDbEvent('post_comment_create', 'post', postId)
        invalidatePostQueries()
      }
      return result
    } catch (err) {
      logger.error('[usePostInteractions] createComment error:', err)
      reportSupabaseError('usePostInteractions.createComment', err, {
        contentLength: content.length,
      }, { feature: 'post_interactions', op: 'create_comment' })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create comment',
      }
    }
  }, [invalidatePostQueries])

  const deleteComment = useCallback(async (commentId: string): Promise<SimpleResult> => {
    try {
      const { data, error } = await withTimeout(
         
        async () => await supabase.rpc('delete_post_comment', {
          p_comment_id: commentId,
        }),
        15_000
      )

      if (error) throw error

      const result = data as unknown as SimpleResult
      if (result.success) {
        trackDbEvent('post_comment_delete', 'comment', commentId)
        invalidatePostQueries()
      }
      return result
    } catch (err) {
      logger.error('[usePostInteractions] deleteComment error:', err)
      reportSupabaseError('usePostInteractions.deleteComment', err, {}, {
        feature: 'post_interactions', op: 'delete_comment',
      })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete comment',
      }
    }
  }, [invalidatePostQueries])

  return { toggleLike, fetchComments, createComment, deleteComment }
}
