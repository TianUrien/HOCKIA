import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'

export type UmpireAppointment = Database['public']['Tables']['umpire_appointments']['Row']
export type UmpireAppointmentInsert = Database['public']['Tables']['umpire_appointments']['Insert']
export type UmpireAppointmentUpdate = Database['public']['Tables']['umpire_appointments']['Update']

export type UmpireAppointmentInput = Omit<
  UmpireAppointmentInsert,
  'id' | 'user_id' | 'created_at' | 'updated_at' | 'display_order'
>

interface UseUmpireAppointmentsOptions {
  /** Profile whose appointments to fetch. Null defers the fetch. */
  userId: string | null
}

interface UseUmpireAppointmentsResult {
  appointments: UmpireAppointment[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (input: UmpireAppointmentInput) => Promise<UmpireAppointment | null>
  update: (id: string, input: Partial<UmpireAppointmentInput>) => Promise<UmpireAppointment | null>
  remove: (id: string) => Promise<boolean>
}

/**
 * Read + CRUD hook for umpire_appointments.
 *
 * RLS guarantees:
 * - Anyone can SELECT (public read).
 * - Only the owner (auth.uid() = user_id) can INSERT/UPDATE/DELETE.
 *
 * Mutations always refetch the full list after success — matches the
 * JourneyTab pattern and keeps ordering correct without optimistic-state
 * bookkeeping. Owner mutations from a read-only viewer will silently RLS-fail.
 */
export function useUmpireAppointments({ userId }: UseUmpireAppointmentsOptions): UseUmpireAppointmentsResult {
  const [appointments, setAppointments] = useState<UmpireAppointment[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(userId))
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!userId) {
      setAppointments([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('umpire_appointments')
        .select('*')
        .eq('user_id', userId)
        .order('start_date', { ascending: false, nullsFirst: false })
        .order('display_order', { ascending: false })

      if (fetchError) throw fetchError
      setAppointments(data ?? [])
    } catch (err) {
      logger.error('[useUmpireAppointments] fetch failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: UmpireAppointmentInput): Promise<UmpireAppointment | null> => {
      if (!userId) return null
      try {
        const { data, error: insertError } = await supabase
          .from('umpire_appointments')
          .insert({ ...input, user_id: userId })
          .select()
          .single()

        if (insertError) throw insertError
        await refresh()
        return data
      } catch (err) {
        logger.error('[useUmpireAppointments] create failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to create appointment')
        return null
      }
    },
    [userId, refresh]
  )

  const update = useCallback(
    async (id: string, input: Partial<UmpireAppointmentInput>): Promise<UmpireAppointment | null> => {
      try {
        const { data, error: updateError } = await supabase
          .from('umpire_appointments')
          .update(input)
          .eq('id', id)
          .select()
          .single()

        if (updateError) throw updateError
        await refresh()
        return data
      } catch (err) {
        logger.error('[useUmpireAppointments] update failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to update appointment')
        return null
      }
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error: deleteError } = await supabase
          .from('umpire_appointments')
          .delete()
          .eq('id', id)

        if (deleteError) throw deleteError
        await refresh()
        return true
      } catch (err) {
        logger.error('[useUmpireAppointments] delete failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to delete appointment')
        return false
      }
    },
    [refresh]
  )

  return { appointments, loading, error, refresh, create, update, remove }
}
