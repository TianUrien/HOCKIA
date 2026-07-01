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
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { markSavedProfileId, unmarkSavedProfileId, resyncSavedProfileIds } from '@/hooks/useSavedProfiles'
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

// ── Module-level shared store ───────────────────────────────────────
//
// QA F3: each consumer (MoveToShortlistMenu picker, ShortlistsIndex,
// ShortlistDetail) was calling its own useEffect → its own fetch.
// Opening the ⋯ picker N times in a session fired N identical
// `?select=*,saved_profiles(count)` GETs to the same owner. Agent
// observed 7 fetches in a single Players-tab interaction.
//
// Fix: move state into a module-level zustand store + dedupe in-flight
// promises. First consumer triggers the fetch, subsequent consumers
// (and re-mounts) reuse the cached result. Mutations (create/rename/
// remove/setDefault) re-run the fetch through `refresh()` so item
// counts stay current after writes.

interface ShortlistsStoreState {
  ownerId: string | null
  lists: ShortlistWithCount[]
  loading: boolean
  error: string | null
  /** When non-null, a fetch is in flight — awaiting consumers join it
   *  instead of firing their own. */
  inflight: Promise<void> | null
  /** Run once per owner (or after invalidate). No-op when a fresh
   *  cached result already exists. */
  ensureFetched: (ownerId: string) => Promise<void>
  /** Force a fresh fetch — used by mutations to pick up new counts. */
  refresh: (ownerId: string) => Promise<void>
  /** Drop the cache (called on sign-out / owner change). */
  clear: () => void
}

const useShortlistsStore = create<ShortlistsStoreState>((set, get) => {
  const runFetch = (ownerId: string): Promise<void> => {
    set({ ownerId, loading: true, error: null })
    const promise = (async () => {
      const { data, error: fetchError } = await supabase
        .from('shortlists')
        .select('*, saved_profiles(count)')
        .eq('owner_id', ownerId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
      if (fetchError) {
        reportSupabaseError('useShortlistsStore.fetch', fetchError)
        set({ error: 'Could not load shortlists', loading: false, inflight: null })
        return
      }
      const lists = (data ?? []).map((row) => {
        const counts = row.saved_profiles as { count: number }[] | null
        const itemCount = counts?.[0]?.count ?? 0
        return { ...row, item_count: itemCount } as ShortlistWithCount
      })
      set({ lists, loading: false, inflight: null })
    })()
    set({ inflight: promise })
    return promise
  }
  return {
    ownerId: null,
    lists: [],
    loading: false,
    error: null,
    inflight: null,
    ensureFetched: async (ownerId) => {
      const state = get()
      // Cache hit — same owner, already loaded, no in-flight fetch.
      if (state.ownerId === ownerId && !state.inflight && !state.loading) {
        return
      }
      // Dedup — a fetch for this owner is already running, join it.
      if (state.inflight && state.ownerId === ownerId) {
        return state.inflight
      }
      // Owner changed (sign-in switch) — drop stale data + refetch.
      if (state.ownerId !== ownerId) {
        set({ lists: [], error: null })
      }
      return runFetch(ownerId)
    },
    refresh: async (ownerId) => runFetch(ownerId),
    clear: () => set({ ownerId: null, lists: [], loading: false, error: null, inflight: null }),
  }
})

/** Test-only escape hatch — resets the singleton between test files
 *  that share the module graph. Not exported from the barrel. */
export function __resetShortlistsStoreForTests() {
  useShortlistsStore.getState().clear()
}

export function useShortlists(): UseShortlistsResult {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const viewerId = viewer?.id ?? null

  // Selector subscriptions — only re-render when the field changes.
  const lists = useShortlistsStore((s) => s.lists)
  const loading = useShortlistsStore((s) => s.loading)
  const error = useShortlistsStore((s) => s.error)

  useEffect(() => {
    if (!viewerId) {
      useShortlistsStore.getState().clear()
      return
    }
    void useShortlistsStore.getState().ensureFetched(viewerId)
  }, [viewerId])

  const refresh = useCallback(async () => {
    if (!viewerId) return
    await useShortlistsStore.getState().refresh(viewerId)
  }, [viewerId])

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
    // Deleting the list cascade-removed its saved_profiles rows, so any card
    // "Saved" heart for those players is now stale — re-derive the set.
    await resyncSavedProfileIds()
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
  /** Move an item to a different shortlist (drag/drop or move action).
   *  Pass the destination list's name so the success toast can
   *  surface it ("Moved to <name>") instead of a generic string. */
  moveTo: (itemId: string, targetShortlistId: string, targetName?: string) => Promise<void>
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
      // 23505 = unique violation (already saved); silently no-op — but the
      // player IS saved, so keep the heart in sync before bailing.
      if (insertError.code !== '23505') {
        reportSupabaseError('useShortlistItems.add', insertError)
        addToast('Could not add to shortlist', 'error')
        return
      }
      markSavedProfileId(playerId)
      return
    }
    // Card "Saved" heart reads the shared saved-ids set — mark it filled.
    markSavedProfileId(playerId)
    trackDbEvent('shortlist.item_added', 'shortlist', shortlistId, { player_id: playerId })
    await refresh()
  }, [viewerId, shortlistId, refresh, addToast])

  const remove = useCallback(async (itemId: string) => {
    if (!viewerId) return
    // Optimistic local removal so the row disappears instantly; revert
    // on error.
    const previous = items
    const removedProfileId = items.find((it) => it.id === itemId)?.saved_profile_id ?? null
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
    // saved_profiles is UNIQUE(owner_id, saved_profile_id) → this was the
    // player's only saved row, so the card "Saved" heart must clear too.
    if (removedProfileId) unmarkSavedProfileId(removedProfileId)
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
    // F10 (QA): silent success felt broken even though the optimistic
    // pill update was correct. Confirm-saved toast resolves the
    // "did anything happen?" gap.
    const STATUS_LABEL: Record<ShortlistItemStatus, string> = {
      unsorted: 'Marked Unsorted',
      good_fit: 'Marked Good fit',
      maybe: 'Marked Maybe',
      not_a_fit: 'Marked Not a fit',
    }
    addToast(STATUS_LABEL[status], 'success')
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
    // F10 (QA): toast on note save so the user knows the blur
    // committed. Different copy for clear-note so they can tell
    // their text was wiped.
    addToast(note == null ? 'Note cleared' : 'Note saved', 'success')
  }, [viewerId, items, addToast])

  const moveTo = useCallback(async (itemId: string, targetShortlistId: string, targetName?: string) => {
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
      return
    }
    // F11 + R2 (QA): toast the success so the user knows the row
    // actually landed somewhere; include the destination list's name
    // when the caller passed one ("Moved to Women's pre-season"
    // beats a generic "Moved to other list").
    addToast(
      targetName ? `Moved to ${targetName}` : 'Moved to other list',
      'success',
    )
  }, [viewerId, shortlistId, items, addToast])

  return { items, loading, error, refresh, add, remove, setStatus, setNote, moveTo }
}
