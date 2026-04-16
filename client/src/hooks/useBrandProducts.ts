/**
 * useBrandProducts Hook
 *
 * CRUD hook for brand products. Fetches, creates, updates, and soft-deletes
 * products for a given brand.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface ProductImage {
  url: string
  order: number
}

export interface BrandProduct {
  id: string
  brand_id: string
  name: string
  description: string | null
  images: ProductImage[]
  external_url: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CreateProductInput {
  name: string
  description?: string
  images: ProductImage[]
  external_url?: string
}

export interface UpdateProductInput {
  name?: string
  description?: string
  images?: ProductImage[]
  external_url?: string
}

interface UseBrandProductsResult {
  products: BrandProduct[]
  isLoading: boolean
  error: string | null
  createProduct: (data: CreateProductInput) => Promise<{ success: boolean; product_id?: string; error?: string }>
  updateProduct: (productId: string, data: UpdateProductInput) => Promise<{ success: boolean; error?: string }>
  deleteProduct: (productId: string) => Promise<{ success: boolean; error?: string }>
  refetch: () => Promise<void>
}

export function useBrandProducts(brandId: string | null | undefined): UseBrandProductsResult {
  const [products, setProducts] = useState<BrandProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProducts = useCallback(async () => {
    if (!brandId) {
      setProducts([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { data, error: rpcError } = await supabase.rpc('get_brand_products', {
        p_brand_id: brandId,
      })

      if (rpcError) throw rpcError

      const parsed = (data as BrandProduct[] | null) ?? []
      setProducts(Array.isArray(parsed) ? parsed : [])
    } catch (err) {
      logger.error('[useBrandProducts] Error fetching products:', err)
      setError(err instanceof Error ? err.message : 'Failed to load products')
      setProducts([])
    } finally {
      setIsLoading(false)
    }
  }, [brandId])

  const createProduct = useCallback(async (data: CreateProductInput) => {
    if (!brandId) return { success: false, error: 'No brand ID' }

    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_brand_product', {
        p_brand_id: brandId,
        p_name: data.name,
        p_description: (data.description ?? null) as string | undefined,
        p_images: data.images as unknown as string,
        p_external_url: (data.external_url ?? null) as string | undefined,
      })

      if (rpcError) throw rpcError

      const response = result as unknown as { success: boolean; product_id: string }
      await fetchProducts()

      return { success: true, product_id: response.product_id }
    } catch (err) {
      logger.error('[useBrandProducts] Error creating product:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create product',
      }
    }
  }, [brandId, fetchProducts])

  const updateProduct = useCallback(async (productId: string, data: UpdateProductInput) => {
    try {
      const { error: rpcError } = await supabase.rpc('update_brand_product', {
        p_product_id: productId,
        p_name: (data.name ?? null) as string | undefined,
        p_description: (data.description ?? null) as string | undefined,
        p_images: (data.images ? (data.images as unknown as string) : null) as string | undefined,
        p_external_url: (data.external_url ?? null) as string | undefined,
      })

      if (rpcError) throw rpcError

      await fetchProducts()
      return { success: true }
    } catch (err) {
      logger.error('[useBrandProducts] Error updating product:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update product',
      }
    }
  }, [fetchProducts])

  const deleteProduct = useCallback(async (productId: string) => {
    try {
      const { error: rpcError } = await supabase.rpc('delete_brand_product', {
        p_product_id: productId,
      })

      if (rpcError) throw rpcError

      await fetchProducts()
      return { success: true }
    } catch (err) {
      logger.error('[useBrandProducts] Error deleting product:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete product',
      }
    }
  }, [fetchProducts])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  return {
    products,
    isLoading,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    refetch: fetchProducts,
  }
}
