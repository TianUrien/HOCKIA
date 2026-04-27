/**
 * Product Health Score API
 * - getProductHealthScore() — current score + diagnostics
 * - getProductHealthTrend() — daily snapshots for sparkline
 */

import { supabase } from '@/lib/supabase'
import type { ProductHealthScore, ProductHealthTrendPoint } from '../types/productHealth'

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

export async function getProductHealthTrend(days = 30): Promise<ProductHealthTrendPoint[]> {
  const { data, error } = await supabase.rpc('admin_get_product_health_trend', { p_days: days })

  if (error) {
    throw new Error(`Failed to fetch product health trend: ${error.message}`)
  }

  return (data as unknown as ProductHealthTrendPoint[]) ?? []
}
