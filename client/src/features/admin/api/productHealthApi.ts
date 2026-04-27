/**
 * Product Health Score API
 * - getProductHealthScore() — current score + diagnostics
 * - getProductHealthTrend() — daily snapshots for sparkline
 *
 * Both surface RPC failures to Sentry via reportSupabaseError so a
 * broken score function (e.g. schema drift, RPC permission issue,
 * cron-snapshot regression) shows up as a tracked issue rather than
 * a silent admin-only error block.
 */

import { supabase } from '@/lib/supabase'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import type { ProductHealthScore, ProductHealthTrendPoint } from '../types/productHealth'

export async function getProductHealthScore(): Promise<ProductHealthScore> {
  const { data, error } = await supabase.rpc('admin_get_product_health_score')

  if (error) {
    reportSupabaseError('admin.productHealthScore.fetch', error, {}, {
      feature: 'admin_product_health',
      rpc: 'admin_get_product_health_score',
    })
    throw new Error(`Failed to fetch product health score: ${error.message}`)
  }
  if (!data) {
    const empty = new Error('Empty response from admin_get_product_health_score')
    reportSupabaseError('admin.productHealthScore.empty', empty, {}, {
      feature: 'admin_product_health',
      rpc: 'admin_get_product_health_score',
    })
    throw empty
  }

  return data as unknown as ProductHealthScore
}

export async function getProductHealthTrend(days = 30): Promise<ProductHealthTrendPoint[]> {
  const { data, error } = await supabase.rpc('admin_get_product_health_trend', { p_days: days })

  if (error) {
    reportSupabaseError('admin.productHealthTrend.fetch', error, { days }, {
      feature: 'admin_product_health',
      rpc: 'admin_get_product_health_trend',
    })
    throw new Error(`Failed to fetch product health trend: ${error.message}`)
  }

  return (data as unknown as ProductHealthTrendPoint[]) ?? []
}
