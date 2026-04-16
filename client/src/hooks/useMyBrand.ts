/**
 * useMyBrand Hook
 *
 * React hook for fetching the current authenticated user's brand.
 * Used on the Brand dashboard and onboarding pages.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import type { BrandDetail } from './useBrand'

interface UseMyBrandResult {
  brand: BrandDetail | null
  isLoading: boolean
  error: string | null
  hasBrand: boolean
  refetch: () => Promise<void>
  createBrand: (data: CreateBrandInput) => Promise<{ success: boolean; slug?: string; error?: string }>
  updateBrand: (data: UpdateBrandInput) => Promise<{ success: boolean; error?: string }>
}

export interface CreateBrandInput {
  name: string
  slug: string
  category: string
  bio?: string
  logo_url?: string
  website_url?: string
  instagram_url?: string
}

export interface UpdateBrandInput {
  name?: string
  bio?: string
  logo_url?: string
  website_url?: string
  instagram_url?: string
  category?: string
}

export function useMyBrand(): UseMyBrandResult {
  const { user, profile } = useAuthStore()
  const [brand, setBrand] = useState<BrandDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMyBrand = useCallback(async () => {
    if (!user || profile?.role !== 'brand') {
      setBrand(null)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { data, error: rpcError } = await supabase.rpc('get_my_brand')

      if (rpcError) {
        throw rpcError
      }

      setBrand(data as BrandDetail | null)
    } catch (err) {
      logger.error('[useMyBrand] Error fetching brand:', err)
      setError(err instanceof Error ? err.message : 'Failed to load brand')
      setBrand(null)
    } finally {
      setIsLoading(false)
    }
  }, [user, profile?.role])

  const createBrand = useCallback(async (data: CreateBrandInput) => {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_brand', {
        p_name: data.name,
        p_slug: data.slug,
        p_category: data.category,
        p_bio: (data.bio ?? null) as string | undefined,
        p_logo_url: (data.logo_url ?? null) as string | undefined,
        p_website_url: (data.website_url ?? null) as string | undefined,
        p_instagram_url: (data.instagram_url ?? null) as string | undefined,
      })

      if (rpcError) {
        throw rpcError
      }

      const response = result as { success: boolean; brand_id: string; slug: string }

      // Sync brand identity to profile so it shows in Community, Messages, Header, etc.
      if (user) {
        const profileUpdate: Record<string, string> = {}
        if (data.name) profileUpdate.full_name = data.name
        if (data.logo_url) profileUpdate.avatar_url = data.logo_url
        if (Object.keys(profileUpdate).length > 0) {
          await supabase.from('profiles').update(profileUpdate).eq('id', user.id)
        }
      }

      // Refetch to get the full brand data
      await fetchMyBrand()

      return { success: true, slug: response.slug }
    } catch (err) {
      logger.error('[useMyBrand] Error creating brand:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create brand',
      }
    }
  }, [fetchMyBrand, user])

  const updateBrand = useCallback(async (data: UpdateBrandInput) => {
    try {
      const { error: rpcError } = await supabase.rpc('update_brand', {
        p_name: (data.name ?? null) as string | undefined,
        p_bio: (data.bio ?? null) as string | undefined,
        p_logo_url: (data.logo_url ?? null) as string | undefined,
        p_website_url: (data.website_url ?? null) as string | undefined,
        p_instagram_url: (data.instagram_url ?? null) as string | undefined,
        p_category: (data.category ?? null) as string | undefined,
      })

      if (rpcError) {
        throw rpcError
      }

      // Sync brand identity to profile so it stays consistent everywhere
      if (user) {
        const profileUpdate: Record<string, string> = {}
        if (data.name) profileUpdate.full_name = data.name
        if (data.logo_url) profileUpdate.avatar_url = data.logo_url
        if (Object.keys(profileUpdate).length > 0) {
          await supabase.from('profiles').update(profileUpdate).eq('id', user.id)
        }
      }

      // Refetch to get the updated data
      await fetchMyBrand()

      return { success: true }
    } catch (err) {
      logger.error('[useMyBrand] Error updating brand:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update brand',
      }
    }
  }, [fetchMyBrand, user])

  useEffect(() => {
    fetchMyBrand()
  }, [fetchMyBrand])

  return {
    brand,
    isLoading,
    error,
    hasBrand: brand !== null,
    refetch: fetchMyBrand,
    createBrand,
    updateBrand,
  }
}
