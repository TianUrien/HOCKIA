/**
 * useProductHealthTrend — fetches the last N daily Product Health snapshots
 * for the AdminOverview sparkline. The pg_cron job runs at 02:00 UTC, so
 * the most recent snapshot can be up to ~24h old; cached for 10 min.
 */

import { useQuery } from '@tanstack/react-query'
import { getProductHealthTrend } from '../api/productHealthApi'
import type { ProductHealthTrendPoint } from '../types/productHealth'

interface UseProductHealthTrendResult {
  trend: ProductHealthTrendPoint[]
  isLoading: boolean
  error: string | null
  refetch: () => unknown
}

export function useProductHealthTrend(days = 30): UseProductHealthTrendResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery<ProductHealthTrendPoint[]>({
    queryKey: ['admin', 'productHealthTrend', days],
    queryFn: () => getProductHealthTrend(days),
    staleTime: 10 * 60 * 1000,
  })

  return {
    trend: data ?? [],
    isLoading: isLoading || isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch,
  }
}
