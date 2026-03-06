/**
 * useCommandCenter Hook
 *
 * Fetches and caches command center analytics for the admin portal.
 * Uses React Query for automatic caching (5-minute stale time).
 */

import { useQuery } from '@tanstack/react-query'
import type { CommandCenterStats, RetentionCohort, ActivationFunnelData, UserGrowthPoint } from '../types'
import { getCommandCenterStats, getRetentionCohorts, getActivationFunnel, getUserGrowthChart } from '../api/adminApi'

interface CommandCenterData {
  stats: CommandCenterStats
  growthData: UserGrowthPoint[]
  cohorts: RetentionCohort[]
  funnel: ActivationFunnelData
}

interface UseCommandCenterResult {
  stats: CommandCenterStats | null
  growthData: UserGrowthPoint[]
  cohorts: RetentionCohort[]
  funnel: ActivationFunnelData | null
  isLoading: boolean
  error: string | null
  refetch: () => unknown
}

export function useCommandCenter(days: number): UseCommandCenterResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery<CommandCenterData>({
    queryKey: ['admin', 'commandCenter', days],
    queryFn: async () => {
      const [stats, growthData, cohorts, funnel] = await Promise.all([
        getCommandCenterStats(days),
        getUserGrowthChart(days),
        getRetentionCohorts(3),
        getActivationFunnel(days),
      ])
      return { stats, growthData, cohorts, funnel }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return {
    stats: data?.stats ?? null,
    growthData: data?.growthData ?? [],
    cohorts: data?.cohorts ?? [],
    funnel: data?.funnel ?? null,
    isLoading: isLoading || isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch,
  }
}
