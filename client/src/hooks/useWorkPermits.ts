import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'
import {
  sortWorkPermits,
  validateWorkPermitDraft,
  workPermitStatus,
  type WorkPermitDraft,
  type WorkPermitDraftError,
  type WorkPermitRow,
  type WorkPermitStatus,
} from '@/lib/workPermits'

export type WorkPermitWithStatus = WorkPermitRow & { status: WorkPermitStatus }

export type WorkPermitMutationResult =
  | { ok: true; row?: WorkPermitRow }
  | { ok: false; reason: WorkPermitDraftError | 'not_owner' | 'error'; error?: unknown }

const COLUMNS = 'id, player_id, country_id, type, valid_from, expires_on, created_at, updated_at'

/**
 * A player's visas & work permits (D2 · 30-second profile).
 *
 * Reads and writes go straight to player_work_permits through supabase-js;
 * RLS is the fence: the owner has full CRUD on their own rows, recruiters
 * (clubs + recruiting coaches) can read rows of non-hidden players, everyone
 * else gets an empty list. Pass the profile being viewed; the mutations only
 * run when that profile is the signed-in user.
 *
 * A write changes the player's completeness score server-side (DEFINER
 * trigger), so callers that show the score should refresh the profile.
 */
export function useWorkPermits(playerId: string | null | undefined, opts?: { enabled?: boolean }) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const queryClient = useQueryClient()
  const id = playerId ?? null
  const isOwner = !!id && id === viewerId

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.workPermits(id),
    enabled: !!id && !!viewerId && (opts?.enabled ?? true),
    staleTime: 60_000,
    queryFn: async (): Promise<WorkPermitRow[]> => {
      const { data: rows, error: selectError } = await supabase
        .from('player_work_permits')
        .select(COLUMNS)
        .eq('player_id', id as string)
        .order('expires_on', { ascending: true, nullsFirst: false })
      if (selectError) throw selectError
      return (rows ?? []) as WorkPermitRow[]
    },
  })

  useEffect(() => {
    if (error) logger.debug('[useWorkPermits] load failed', error)
  }, [error])

  const permits = useMemo<WorkPermitWithStatus[]>(() => {
    const today = new Date()
    return sortWorkPermits(data ?? [], today).map((row) => ({
      ...row,
      status: workPermitStatus(row.valid_from, row.expires_on, today),
    }))
  }, [data])

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: qk.workPermits(id) }),
    [queryClient, id],
  )

  const addPermit = useCallback(async (draft: WorkPermitDraft): Promise<WorkPermitMutationResult> => {
    if (!isOwner || !id) return { ok: false, reason: 'not_owner' }
    const invalid = validateWorkPermitDraft(draft)
    if (invalid) return { ok: false, reason: invalid }
    const { data: row, error: insertError } = await supabase
      .from('player_work_permits')
      .insert({
        player_id: id,
        country_id: draft.country_id as number,
        type: draft.type as string,
        valid_from: draft.valid_from?.trim() ? draft.valid_from : null,
        expires_on: draft.expires_on?.trim() ? draft.expires_on : null,
      })
      .select(COLUMNS)
      .single()
    if (insertError) {
      logger.error('[useWorkPermits] add failed', insertError)
      return { ok: false, reason: 'error', error: insertError }
    }
    await invalidate()
    return { ok: true, row: row as WorkPermitRow }
  }, [id, isOwner, invalidate])

  const updatePermit = useCallback(async (permitId: string, draft: WorkPermitDraft): Promise<WorkPermitMutationResult> => {
    if (!isOwner || !id) return { ok: false, reason: 'not_owner' }
    const invalid = validateWorkPermitDraft(draft)
    if (invalid) return { ok: false, reason: invalid }
    const { data: row, error: updateError } = await supabase
      .from('player_work_permits')
      .update({
        country_id: draft.country_id as number,
        type: draft.type as string,
        valid_from: draft.valid_from?.trim() ? draft.valid_from : null,
        expires_on: draft.expires_on?.trim() ? draft.expires_on : null,
      })
      .eq('id', permitId)
      .eq('player_id', id)
      .select(COLUMNS)
      .single()
    if (updateError) {
      logger.error('[useWorkPermits] update failed', updateError)
      return { ok: false, reason: 'error', error: updateError }
    }
    await invalidate()
    return { ok: true, row: row as WorkPermitRow }
  }, [id, isOwner, invalidate])

  const removePermit = useCallback(async (permitId: string): Promise<WorkPermitMutationResult> => {
    if (!isOwner || !id) return { ok: false, reason: 'not_owner' }
    const { error: deleteError } = await supabase
      .from('player_work_permits')
      .delete()
      .eq('id', permitId)
      .eq('player_id', id)
    if (deleteError) {
      logger.error('[useWorkPermits] remove failed', deleteError)
      return { ok: false, reason: 'error', error: deleteError }
    }
    await invalidate()
    return { ok: true }
  }, [id, isOwner, invalidate])

  return {
    permits,
    loading: isLoading,
    error: error ?? null,
    isOwner,
    /** Owner only: any permit expiring within 30 days or expired (amber row). */
    needsAttention: isOwner && permits.some((p) => p.status === 'expiring_soon' || p.status === 'expired'),
    refetch,
    addPermit,
    updatePermit,
    removePermit,
  }
}
