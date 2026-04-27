/**
 * useProductHealthScore — fetches the HOCKIA Product Health Score
 *
 * The score is a heavy aggregation; the RPC takes ~50–200ms at current
 * scale. Cached for 5 minutes so navigating between admin pages doesn't
 * re-fire the computation. Falls into the same TanStack pattern used by
 * useAdminStats / useCommandCenter.
 */

import { useQuery } from '@tanstack/react-query'
import { getProductHealthScore } from '../api/productHealthApi'
import type { ProductHealthScore } from '../types/productHealth'

interface UseProductHealthScoreResult {
  score: ProductHealthScore | null
  isLoading: boolean
  error: string | null
  refetch: () => unknown
}

export function useProductHealthScore(): UseProductHealthScoreResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery<ProductHealthScore>({
    queryKey: ['admin', 'productHealthScore'],
    queryFn: getProductHealthScore,
    staleTime: 5 * 60 * 1000,
  })

  return {
    score: data ?? null,
    isLoading: isLoading || isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch,
  }
}
