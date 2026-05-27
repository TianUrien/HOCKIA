/**
 * Saved Profiles — Phase 1 of the Career Snapshot + Shortlist initiative.
 *
 * Lets a logged-in user privately "save" another player's profile for
 * later review (Save action on MemberTile, MemberPreviewModal, profile
 * page, etc). The saved player never sees they were saved — RLS gates
 * all reads on owner_id, and we never surface a "you were saved"
 * notification anywhere.
 *
 * Two hooks:
 *   - `useIsProfileSaved(profileId)` — for the Save button on any
 *     surface that shows ONE player. Returns the boolean + a toggle.
 *   - `useSavedProfilesList()` — for the Saved Candidates page.
 *     Returns the list of saved rows joined with the saved profile's
 *     public fields (name, role, avatar, etc).
 *
 * Phase 1 is single-bucket (no named lists yet). Schema is forward-
 * compatible — adding a `shortlist_id` column later won't break reads.
 *
 * Architecture note (Sprint 4 perf fix):
 *   The per-card "is this saved?" lookup used to fire one SELECT per
 *   tile (Community grid with 16 cards = 16+ saved_profiles round-
 *   trips, doubled under StrictMode). It now reads from a shared
 *   zustand store that loads the FULL set of saved ids ONCE per
 *   viewer per session — collapsing N+1 → 1. Cards subscribe to
 *   `set.has(id)` via a fine-grained selector so unrelated saves
 *   don't re-render the whole grid.
 */

import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'

export interface SavedProfileSummary {
  id: string
  saved_profile_id: string
  note: string | null
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
    open_to_play: boolean | null
    open_to_coach: boolean | null
    is_verified: boolean | null
  } | null
}

export interface UseIsProfileSavedResult {
  isSaved: boolean
  loading: boolean
  mutating: boolean
  toggle: () => Promise<void>
  /** True for owners viewing their own profile — Save is meaningless. */
  isOwnProfile: boolean
  /** True when no auth — Save is gated. */
  isAuthenticated: boolean
}

// ── Saved-ids store (shared across all useIsProfileSaved callers) ────

type SavedIdsStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface SavedProfileIdsStoreState {
  ownerId: string | null
  ids: Set<string>
  status: SavedIdsStatus
  /** Synchronous claim so concurrent ensureFetched callers from many
   *  MemberTile mounts in the same render commit dedupe to one fetch. */
  fetchedForOwner: string | null
  setOwner: (ownerId: string | null) => void
  ensureFetched: () => Promise<void>
  refresh: () => Promise<void>
  /** Optimistic add + remove for the toggle flow. Reverts on error. */
  addLocally: (profileId: string) => void
  removeLocally: (profileId: string) => void
}

const useSavedProfileIdsStore = create<SavedProfileIdsStoreState>((set, get) => ({
  ownerId: null,
  ids: new Set<string>(),
  status: 'idle',
  fetchedForOwner: null,

  setOwner: (ownerId) => {
    if (get().ownerId === ownerId) return
    set({
      ownerId,
      ids: new Set<string>(),
      status: 'idle',
      fetchedForOwner: null,
    })
  },

  ensureFetched: async () => {
    const { ownerId, fetchedForOwner } = get()
    if (!ownerId) return
    if (fetchedForOwner === ownerId) return
    set({ fetchedForOwner: ownerId, status: 'loading' })
    await get().refresh()
  },

  refresh: async () => {
    const { ownerId } = get()
    if (!ownerId) {
      set({ ids: new Set(), status: 'idle', fetchedForOwner: null })
      return
    }
    set({ status: 'loading', fetchedForOwner: ownerId })
    const { data, error: fetchError } = await supabase
      .from('saved_profiles')
      .select('saved_profile_id')
      .eq('owner_id', ownerId)
    if (fetchError) {
      reportSupabaseError('useSavedProfileIds.refresh', fetchError)
      set({ status: 'error' })
      return
    }
    const next = new Set<string>(
      (data ?? []).map((r) => r.saved_profile_id as string),
    )
    set({ ids: next, status: 'loaded' })
  },

  addLocally: (profileId) => {
    const next = new Set(get().ids)
    next.add(profileId)
    set({ ids: next })
  },

  removeLocally: (profileId) => {
    const next = new Set(get().ids)
    next.delete(profileId)
    set({ ids: next })
  },
}))

/**
 * Per-profile Save state for use on a single-player surface (MemberTile,
 * MemberPreviewModal, ProfilePage). Tracks whether the current user has
 * saved THIS profile, and exposes a toggle.
 */
export function useIsProfileSaved(profileId: string | null | undefined): UseIsProfileSavedResult {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const viewerId = viewer?.id ?? null
  const [mutating, setMutating] = useState(false)

  const isAuthenticated = Boolean(viewerId)
  const isOwnProfile = Boolean(viewerId && profileId && viewerId === profileId)

  // Fine-grained selector — re-renders only when THIS profileId's
  // membership in the set flips. Unrelated saves on other cards don't
  // re-render every Save button on the page.
  const isSaved = useSavedProfileIdsStore((s) =>
    profileId ? s.ids.has(profileId) : false,
  )
  const status = useSavedProfileIdsStore((s) => s.status)
  const setOwner = useSavedProfileIdsStore((s) => s.setOwner)
  const ensureFetched = useSavedProfileIdsStore((s) => s.ensureFetched)
  const addLocally = useSavedProfileIdsStore((s) => s.addLocally)
  const removeLocally = useSavedProfileIdsStore((s) => s.removeLocally)

  // Sync the viewer + kick off the one-shot fetch. Both effects are
  // safe under StrictMode / Suspense replay because setOwner is a
  // no-op for the same owner and ensureFetched short-circuits on
  // `fetchedForOwner === ownerId`.
  useEffect(() => {
    setOwner(viewerId)
  }, [viewerId, setOwner])

  useEffect(() => {
    if (!viewerId) return
    void ensureFetched()
  }, [viewerId, ensureFetched])

  const toggle = useCallback(async () => {
    if (!viewerId) {
      addToast('Sign in to save players', 'error')
      return
    }
    if (!profileId || isOwnProfile || mutating) return

    setMutating(true)

    try {
      if (isSaved) {
        // Optimistic — flip local set first so the heart updates
        // instantly; revert on DB error.
        removeLocally(profileId)
        const { error } = await supabase
          .from('saved_profiles')
          .delete()
          .eq('owner_id', viewerId)
          .eq('saved_profile_id', profileId)
        if (error) {
          addLocally(profileId)
          reportSupabaseError('useIsProfileSaved.unsave', error, { profileId })
          addToast('Could not remove from saved', 'error')
          return
        }
      } else {
        addLocally(profileId)
        // Quick-save always writes to the owner's default shortlist.
        // For brand-new owners with no default list yet, create one
        // first (idempotent — the partial unique index prevents two
        // defaults landing concurrently; the second insert would 23505
        // and we fall through to the lookup branch).
        let defaultListId: string | null = null
        const { data: existing } = await supabase
          .from('shortlists')
          .select('id')
          .eq('owner_id', viewerId)
          .eq('is_default', true)
          .maybeSingle()
        if (existing?.id) {
          defaultListId = existing.id
        } else {
          const { data: created, error: createErr } = await supabase
            .from('shortlists')
            .insert({ owner_id: viewerId, name: 'Saved players', is_default: true })
            .select('id')
            .single()
          if (createErr) {
            // Race fallback: another tab just created it. Look up.
            const { data: recheck } = await supabase
              .from('shortlists')
              .select('id')
              .eq('owner_id', viewerId)
              .eq('is_default', true)
              .maybeSingle()
            defaultListId = recheck?.id ?? null
          } else {
            defaultListId = created.id
          }
        }
        if (!defaultListId) {
          removeLocally(profileId)
          addToast('Could not create your saved list', 'error')
          return
        }
        const { error } = await supabase
          .from('saved_profiles')
          .insert({
            owner_id: viewerId,
            saved_profile_id: profileId,
            shortlist_id: defaultListId,
          })
        if (error) {
          // Already in the list (23505) → silent no-op (the local set
          // already shows it as saved, which is correct).
          if (error.code !== '23505') {
            removeLocally(profileId)
            reportSupabaseError('useIsProfileSaved.save', error, { profileId })
            addToast('Could not save player', 'error')
            return
          }
        } else {
          addToast('Saved — see Saved Candidates in your dashboard', 'success')
        }
      }
    } finally {
      setMutating(false)
    }
  }, [viewerId, profileId, isSaved, isOwnProfile, mutating, addToast, addLocally, removeLocally])

  return {
    isSaved,
    loading: status === 'loading' || status === 'idle',
    mutating,
    toggle,
    isOwnProfile,
    isAuthenticated,
  }
}

export interface UseSavedProfilesListResult {
  items: SavedProfileSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * List view for the Saved Candidates page. Returns saved rows joined
 * with each saved player's public profile fields, newest-first.
 */
export function useSavedProfilesList(): UseSavedProfilesListResult {
  const { profile: viewer } = useAuthStore()
  const viewerId = viewer?.id
  const [items, setItems] = useState<SavedProfileSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!viewerId) {
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
        note,
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
          open_to_play,
          open_to_coach,
          is_verified
        )
      `)
      .eq('owner_id', viewerId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      reportSupabaseError('useSavedProfilesList', fetchError)
      setError('Could not load saved players')
      setLoading(false)
      return
    }

    setItems((data ?? []) as unknown as SavedProfileSummary[])
    setLoading(false)
  }, [viewerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { items, loading, error, refresh }
}
