import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { opportunityGenderToTarget, useRecruitingContext } from '@/hooks/useRecruitingContext'
import { roleFindPath, type PostRoleDraft } from '@/lib/postRole'

/** What activating a role's recruiting scope needs (the saved row). */
export interface FindForRoleInput {
  id: string
  type: PostRoleDraft['type']
  title: string | null
  gender: string | null
  city: string | null
}

/**
 * "Find players / Find coaches for this role": make the role the active
 * recruiting context first (same scope Post role writes), so Community / Find
 * players never open on whichever role was active before. Waits for the store
 * to refresh, then hands back the path to go to (roleFindPath). Shared by Role
 * posted and the role "…" menu.
 */
export function useFindForRole() {
  const queryClient = useQueryClient()
  const { activateForOpportunity } = useRecruitingContext()
  const [finding, setFinding] = useState(false)

  const findForRole = useCallback(async (role: FindForRoleInput): Promise<string> => {
    setFinding(true)
    try {
      const isPlayer = role.type === 'player'
      await activateForOpportunity({
        opportunityId: role.id,
        // A coach role's team is not a player category; the RPC takes null.
        target: isPlayer ? opportunityGenderToTarget(role.gender) : null,
        region: role.city?.trim() || null,
        label: role.title ?? null,
      })
      // Find players' role list may be cached from before this role existed.
      void queryClient.invalidateQueries({ queryKey: ['scouting', 'open-roles'] })
      return roleFindPath(role.type, role.id)
    } finally {
      setFinding(false)
    }
  }, [activateForOpportunity, queryClient])

  return { findForRole, finding }
}
