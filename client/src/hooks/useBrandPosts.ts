/**
 * useBrandPosts Hook
 *
 * CRUD hook for brand posts (announcements / content).
 * Fetches, creates, updates, and soft-deletes posts for a given brand.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'

export interface BrandPost {
  id: string
  brand_id: string
  content: string
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface CreatePostInput {
  content: string
  image_url?: string
}

export interface UpdatePostInput {
  content?: string
  image_url?: string
}

interface UseBrandPostsResult {
  posts: BrandPost[]
  isLoading: boolean
  error: string | null
  createPost: (data: CreatePostInput) => Promise<{ success: boolean; post_id?: string; error?: string }>
  updatePost: (postId: string, data: UpdatePostInput) => Promise<{ success: boolean; error?: string }>
  deletePost: (postId: string) => Promise<{ success: boolean; error?: string }>
  refetch: () => Promise<void>
}

export function useBrandPosts(brandId: string | null | undefined): UseBrandPostsResult {
  const [posts, setPosts] = useState<BrandPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    if (!brandId) {
      setPosts([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { data, error: rpcError } = await supabase.rpc('get_brand_posts', {
        p_brand_id: brandId,
      })

      if (rpcError) throw rpcError

      const parsed = (data as BrandPost[] | null) ?? []
      setPosts(Array.isArray(parsed) ? parsed : [])
    } catch (err) {
      logger.error('[useBrandPosts] Error fetching posts:', err)
      setError(err instanceof Error ? err.message : 'Failed to load posts')
      setPosts([])
    } finally {
      setIsLoading(false)
    }
  }, [brandId])

  const createPost = useCallback(async (data: CreatePostInput) => {
    if (!brandId) return { success: false, error: 'No brand ID' }

    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_brand_post', {
        p_brand_id: brandId,
        p_content: data.content,
        p_image_url: (data.image_url ?? null) as string | undefined,
      })

      if (rpcError) throw rpcError

      const response = result as unknown as { success: boolean; post_id: string; error?: string }

      if (!response.success) {
        return { success: false, error: response.error }
      }

      trackDbEvent('post_create', 'post', response.post_id, { type: 'brand' })
      await fetchPosts()
      return { success: true, post_id: response.post_id }
    } catch (err) {
      logger.error('[useBrandPosts] Error creating post:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create post',
      }
    }
  }, [brandId, fetchPosts])

  const updatePost = useCallback(async (postId: string, data: UpdatePostInput) => {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('update_brand_post', {
        p_post_id: postId,
        p_content: (data.content ?? null) as string | undefined,
        p_image_url: (data.image_url ?? null) as string | undefined,
      })

      if (rpcError) throw rpcError

      const response = result as unknown as { success: boolean; error?: string }

      if (!response.success) {
        return { success: false, error: response.error }
      }

      await fetchPosts()
      return { success: true }
    } catch (err) {
      logger.error('[useBrandPosts] Error updating post:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update post',
      }
    }
  }, [fetchPosts])

  const deletePost = useCallback(async (postId: string) => {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('delete_brand_post', {
        p_post_id: postId,
      })

      if (rpcError) throw rpcError

      const response = result as unknown as { success: boolean; error?: string }

      if (!response.success) {
        return { success: false, error: response.error }
      }

      trackDbEvent('post_delete', 'post', postId, { type: 'brand' })
      await fetchPosts()
      return { success: true }
    } catch (err) {
      logger.error('[useBrandPosts] Error deleting post:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete post',
      }
    }
  }, [fetchPosts])

  useEffect(() => {
    void fetchPosts()
  }, [fetchPosts])

  return {
    posts,
    isLoading,
    error,
    createPost,
    updatePost,
    deletePost,
    refetch: fetchPosts,
  }
}
