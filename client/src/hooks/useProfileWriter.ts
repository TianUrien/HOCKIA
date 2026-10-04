import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import type { Profile } from '@/lib/supabase'

/**
 * The one write path for a member's own settings columns (phone Settings,
 * and the "Coaching role alerts" switch on a coach's Opportunities): an
 * optimistic override, the profiles update, then a profile refresh. A failed
 * write rolls the override back and says so.
 */
export type ProfileBoolColumn =
  | 'open_to_play' | 'open_to_coach' | 'open_to_opportunities' | 'notify_push'
  | 'notify_messages' | 'notify_applications' | 'notify_opportunities' | 'notify_friends' | 'notify_references' | 'notify_profile_views'
  | 'browse_anonymously' | 'show_last_active' | 'contact_email_public'

export function useProfileWriter() {
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  // Optimistic overrides, dropped once the refreshed profile agrees.
  const [pending, setPending] = useState<Partial<Record<string, unknown>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const read = <T,>(column: keyof Profile, fallback: T): T => (column in pending ? (pending[column as string] as T) : ((profile?.[column] as T | null | undefined) ?? fallback))

  const write = async (patch: Partial<Record<keyof Profile, unknown>>, key: string) => {
    if (!user) return false
    setBusy(key)
    setPending((p) => ({ ...p, ...patch }))
    try {
      const { error } = await supabase.from('profiles').update(patch as never).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      return true
    } catch (err) {
      logger.error('[useProfileWriter] update failed', err)
      addToast('Could not save that. Please try again.', 'error')
      return false
    } finally {
      setPending((p) => { const next = { ...p }; for (const k of Object.keys(patch)) delete next[k]; return next })
      setBusy(null)
    }
  }
  const toggle = (column: ProfileBoolColumn, fallback: boolean) => write({ [column]: !read<boolean>(column, fallback) } as Partial<Record<keyof Profile, unknown>>, column)
  return { read, write, toggle, busy }
}
