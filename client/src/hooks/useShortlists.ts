/**
 * useShortlists / useShortlistItems — P1.5 multi-list upgrade.
 *
 * Spec sections: C.3 + D.2 + G.5/G.8.
 *
 * Two hooks:
 *   - `useShortlists()` — for ShortlistsIndex. Returns the viewer's
 *     lists (newest first) with item counts + which one is default.
 *     Exposes CRUD: create / rename / delete / setDefault.
 *   - `useShortlistItems(shortlistId)` — for ShortlistDetail. Returns
 *     the items in one list joined with the saved player's public
 *     profile fields. Exposes per-item status + note mutations.
 *
 * Quick-add path (one-click bookmark from a card) still goes through
 * `useIsProfileSaved.toggle` in [./useSavedProfiles.ts]; it writes
 * to the owner's default list. New from this slice: if a brand-new
 * owner has no default list yet, the hook creates one on first save.
 *
 * RLS gates everything on owner_id = auth.uid(). Players never read
 * shortlists or shortlist items.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import type { Database } from '@/lib/database.types'

export type ShortlistRow = Database['public']['Tables']['shortlists']['Row']
export type ShortlistItemStatus = 'unsorted' | 'good_fit' | 'maybe' | 'not_a_fit'

export interface ShortlistWithCount extends ShortlistRow {
  item_count: number
}

export interface ShortlistItemSummary {
  id: string
  saved_profile_id: string
  shortlist_id: string
  note: string | null
  status: ShortlistItemStatus
  created_at: string
  // Joined public profile fields — enough to render a card row.
  profile: {
    id: string
    full_name: string | null
    avatar_url: string | null
    role: string
    base_location: string | null
    nationality: string | null
    nationality_country_id: number | null
    current_club: string | null
    position: string | null
    playing_category: string | null
    current_world_club_id: string | null
    open_to_play: boolean | null
    open_to_coach: boolean | null
    open_to_opportunities: boolean | null
    is_verified: boolean | null
    last_active_at: string | null
  } | null
}

// ── useShortlists ────────────────────────────────────────────────────

export interface UseShortlistsResult {
  lists: ShortlistWithCount[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (name: string) => Promise<ShortlistRow | null>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Promote a list to be the owner's default (where quick-saves go). */
  setDefault: (id: string) => Promise<void>
}

export function useShortlists(): UseShortlistsResult {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const viewerId = viewer?.id ?? null
  const [lists, setLists] = useState<ShortlistWithCount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!viewerId) {
      setLists([])
      return
    }
    setLoading(true)
    setError(null)
    // Single query: lists + their item counts via embedded aggregate.
    // PostgREST returns `count` on embedded resources when using the
    // `!count` selector. Saves a second round-trip vs separate counts.
    const { data, error: fetchError } = await supabase
      .from('shortlists')
      .select('*, saved_profiles(count)')
      .eq('owner_id', viewerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
    if (fetchError) {
      reportSupabaseError('useShortlists.refresh', fetchError)
      setError('Could not load shortlists')
      setLoading(false)
      return
    }
    setLists(
      (data ?? []).map((row) => {
        const counts = row.saved_profiles as { count: number }[] | null
        const itemCount = counts?.[0]?.count ?? 0
        return {
          ...row,
          item_count: itemCount,
        } as ShortlistWithCount
      }),
    )
    setLoading(false)
  }, [viewerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async (name: string): Promise<ShortlistRow | null> => {
    if (!viewerId) return null
    const trimmed = name.trim()
    if (!trimmed) {
      addToast('Name your shortlist', 'error')
      return null
    }
    const { data, error: insertError } = await supabase
      .from('shortlists')
      .insert({ owner_id: viewerId, name: trimmed })
      .select('*')
      .single()
    if (insertError) {
      reportSupabaseError('useShortlists.create', insertError)
      addToast('Could not create shortlist', 'error')
      return null
    }
    trackDbEvent('shortlist.created', 'shortlist', (data as ShortlistRow).id, { name: trimmed })
    await refresh()
    return data as ShortlistRow
  }, [viewerId, refresh, addToast])

  const rename = useCallback(async (id: string, name: string) => {
    if (!viewerId) return
    const trimmed = name.trim()
    if (!trimmed) return
    const { error: updateError } = await supabase
      .from('shortlists')
      .update({ name: trimmed })
      .eq('id', id)
      .eq('owner_id', viewerId)
    if (updateError) {
      reportSupabaseError('useShortlists.rename', updateError)
      addToast('Could not rename shortlist', 'error')
      return
    }
    await refresh()
  }, [viewerId, refresh, addToast])

  const remove = useCallback(async (id: string) => {
    if (!viewerId) return
    const target = lists.find((l) => l.id === id)
    if (target?.is_default) {
      addToast('Promote another list to default before deleting this one', 'error')
      return
    }
    const { error: deleteError } = await supabase
      .from('shortlists')
      .delete()
      .eq('id', id)
      .eq('owner_id', viewerId)
    if (deleteError) {
      reportSupabaseError('useShortlists.remove', deleteError)
      addToast('Could not delete shortlist', 'error')
      return
    }
    await refresh()
  }, [viewerId, lists, refresh, addToast])

  const setDefault = useCallback(async (id: string) => {
    if (!viewerId) return
    // Two-step swap: demote the current default, then promote the
    // target. The partial unique index `shortlists_one_default_per_owner`
    // would reject a second is_default=true row, so order matters.
    const { error: demoteError } = await supabase
      .from('shortlists')
      .update({ is_default: false })
      .eq('owner_id', viewerId)
      .eq('is_default', true)
    if (demoteError) {
      reportSupabaseError('useShortlists.setDefault.demote', demoteError)
      addToast('Could not change default list', 'error')
      return
    }
    const { error: promoteError } = await supabase
      .from('shortlists')
      .update({ is_default: true })
      .eq('owner_id', viewerId)
      .eq('id', id)
    if (promoteError) {
      reportSupabaseError('useShortlists.setDefault.promote', promoteError)
      addToast('Could not change default list', 'error')
      return
    }
    await refresh()
  }, [viewerId, refresh, addToast])

  return { lists, loading, error, refresh, create, rename, remove, setDefault }
}

// ── useShortlistItems ───────────────────────────────────────────────

export interface UseShortlistItemsResult {
  items: ShortlistItemSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (playerId: string) => Promise<void>
  remove: (itemId: string) => Promise<void>
  setStatus: (itemId: string, status: ShortlistItemStatus) => Promise<void>
  setNote: (itemId: string, note: string | null) => Promise<void>
  /** Move an item to a different shortlist (drag/drop or move action). */
  moveTo: (itemId: string, targetShortlistId: string) => Promise<void>
}

export function useShortlistItems(shortlistId: string | null | undefined): UseShortlistItemsResult {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const viewerId = viewer?.id ?? null
  const [items, setItems] = useState<ShortlistItemSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!viewerId || !shortlistId) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('saved_profiles')
      .select(`
        id,
        saved_profile_id,
        shortlist_id,
        note,
        status,
        created_at,
        profile:profiles!saved_profiles_saved_profile_id_fkey(
          id,
          full_name,
          avatar_url,
          role,
          base_location,
          nationality,
          nationality_country_id,
          current_club,
          position,
          playing_category,
          current_world_club_id,
          open_to_play,
          open_to_coach,
          open_to_opportunities,
          is_verified,
          last_active_at
        )
      `)
      .eq('shortlist_id', shortlistId)
      .eq('owner_id', viewerId)
      .order('created_at', { ascending: false })
    if (fetchError) {
      reportSupabaseError('useShortlistItems.refresh', fetchError)
      setError('Could not load items')
      setLoading(false)
      return
    }
    setItems((data ?? []) as unknown as ShortlistItemSummary[])
    setLoading(false)
  }, [viewerId, shortlistId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = useCallback(async (playerId: string) => {
    if (!viewerId || !shortlistId) return
    const { error: insertError } = await supabase
      .from('saved_profiles')
      .insert({
        owner_id: viewerId,
        saved_profile_id: playerId,
        shortlist_id: shortlistId,
      })
    if (insertError) {
      // 23505 = unique violation (already in this list); silently no-op.
      if (insertError.code !== '23505') {
        reportSupabaseError('useShortlistItems.add', insertError)
        addToast('Could not add to shortlist', 'error')
      }
      return
    }
    trackDbEvent('shortlist.item_added', 'shortlist', shortlistId, { player_id: playerId })
    await refresh()
  }, [viewerId, shortlistId, refresh, addToast])

  const remove = useCallback(async (itemId: string) => {
    if (!viewerId) return
    // Optimistic local removal so the row disappears instantly; revert
    // on error.
    const previous = items
    setItems((cur) => cur.filter((it) => it.id !== itemId))
    const { error: deleteError } = await supabase
      .from('saved_profiles')
      .delete()
      .eq('id', itemId)
      .eq('owner_id', viewerId)
    if (deleteError) {
      reportSupabaseError('useShortlistItems.remove', deleteError)
      addToast('Could not remove item', 'error')
      setItems(previous)
      return
    }
    trackDbEvent('shortlist.item_removed', 'shortlist_item', itemId)
  }, [viewerId, items, addToast])

  const setStatus = useCallback(async (itemId: string, status: ShortlistItemStatus) => {
    if (!viewerId) return
    // Optimistic local update. Status pills should feel instant.
    const previous = items
    setItems((cur) => cur.map((it) => (it.id === itemId ? { ...it, status } : it)))
    const { error: updateError } = await supabase
      .from('saved_profiles')
      .update({ status })
      .eq('id', itemId)
      .eq('owner_id', viewerId)
    if (updateError) {
      reportSupabaseError('useShortlistItems.setStatus', updateError)
      addToast('Could not update status', 'error')
      setItems(previous)
      return
    }
    trackDbEvent('shortlist.item_status_changed', 'shortlist_item', itemId, { status })
  }, [viewerId, items, addToast])

  const setNote = useCallback(async (itemId: string, note: string | null) => {
    if (!viewerId) return
    const previous = items
    setItems((cur) => cur.map((it) => (it.id === itemId ? { ...it, note } : it)))
    const { error: updateError } = await supabase
      .from('saved_profiles')
      .update({ note })
      .eq('id', itemId)
      .eq('owner_id', viewerId)
    if (updateError) {
      reportSupabaseError('useShortlistItems.setNote', updateError)
      addToast('Could not save note', 'error')
      setItems(previous)
      return
    }
    trackDbEvent('shortlist.note_saved', 'shortlist_item', itemId, { has_note: note != null })
  }, [viewerId, items, addToast])

  const moveTo = useCallback(async (itemId: string, targetShortlistId: string) => {
    if (!viewerId || targetShortlistId === shortlistId) return
    // Optimistic local removal (item leaves the current list); revert
    // on error.
    const previous = items
    setItems((cur) => cur.filter((it) => it.id !== itemId))
    const { error: updateError } = await supabase
      .from('saved_profiles')
      .update({ shortlist_id: targetShortlistId })
      .eq('id', itemId)
      .eq('owner_id', viewerId)
    if (updateError) {
      // Most likely failure: unique violation when the player already
      // exists in the target list. Surface a helpful message.
      if (updateError.code === '23505') {
        addToast('That player is already in the destination list', 'error')
      } else {
        reportSupabaseError('useShortlistItems.moveTo', updateError)
        addToast('Could not move item', 'error')
      }
      setItems(previous)
    }
  }, [viewerId, shortlistId, items, addToast])

  return { items, loading, error, refresh, add, remove, setStatus, setNote, moveTo }
}
