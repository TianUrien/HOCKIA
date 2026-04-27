/**
 * Product Health Score API — calls admin_get_product_health_score RPC.
 */

import { supabase } from '@/lib/supabase'
import type { ProductHealthScore } from '../types/productHealth'

export async function getProductHealthScore(): Promise<ProductHealthScore> {
  const { data, error } = await supabase.rpc('admin_get_product_health_score')

  if (error) {
    throw new Error(`Failed to fetch product health score: ${error.message}`)
  }
  if (!data) {
    throw new Error('Empty response from admin_get_product_health_score')
  }

  return data as unknown as ProductHealthScore
}
