import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import { fetchGoalActions, fetchMyGoal } from '@/lib/memberGoals'

const GOAL_KEY = ['member-goal'] as const

/** The member's private goal (null when signed out). */
export function useMyGoal() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: [...GOAL_KEY, user?.id ?? 'anon'], queryFn: fetchMyGoal, enabled: Boolean(user), staleTime: 5 * 60_000, retry: false })
  return { ...q, refresh: () => qc.invalidateQueries({ queryKey: GOAL_KEY }) }
}

/** Counts behind the set card's rows (real data only). */
export function useGoalActions(enabled: boolean) {
  const user = useAuthStore((s) => s.user)
  return useQuery({ queryKey: ['member-goal-actions', user?.id ?? 'anon'], queryFn: fetchGoalActions, enabled: enabled && Boolean(user), staleTime: 5 * 60_000, retry: false })
}
