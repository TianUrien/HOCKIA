/**
 * useAdminStats Hook
 *
 * Fetches and caches dashboard statistics for the admin portal.
 * Uses React Query for automatic caching (5-minute stale time).
 */

import { useQuery } from '@tanstack/react-query'
import type { DashboardStats, SignupTrend, TopCountry } from '../types'
import { getDashboardStats, getSignupTrends, getTopCountries } from '../api/adminApi'

interface AdminStatsData {
  stats: DashboardStats
  signupTrends: SignupTrend[]
  topCountries: TopCountry[]
}

interface UseAdminStatsResult {
  stats: DashboardStats | null
  signupTrends: SignupTrend[]
  topCountries: TopCountry[]
  isLoading: boolean
  error: string | null
  refetch: () => unknown
}

export function useAdminStats(): UseAdminStatsResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery<AdminStatsData>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const [stats, signupTrends, topCountries] = await Promise.all([
        getDashboardStats(),
        getSignupTrends(30),
        getTopCountries(10),
      ])
      return { stats, signupTrends, topCountries }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return {
    stats: data?.stats ?? null,
    signupTrends: data?.signupTrends ?? [],
    topCountries: data?.topCountries ?? [],
    isLoading: isLoading || isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch,
  }
}
