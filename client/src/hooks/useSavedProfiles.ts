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
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
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

/**
 * Per-profile Save state for use on a single-player surface (MemberTile,
 * MemberPreviewModal, ProfilePage). Tracks whether the current user has
 * saved THIS profile, and exposes a toggle.
 */
export function useIsProfileSaved(profileId: string | null | undefined): UseIsProfileSavedResult {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const viewerId = viewer?.id
  const [isSaved, setIsSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)

  const isAuthenticated = Boolean(viewerId)
  const isOwnProfile = Boolean(viewerId && profileId && viewerId === profileId)

  // Fetch current saved state. Cheap: a single .maybeSingle() on the
  // (owner_id, saved_profile_id) unique index.
  useEffect(() => {
    if (!viewerId || !profileId || isOwnProfile) {
      setIsSaved(false)
      return
    }

    let cancelled = false
    setLoading(true)

    supabase
      .from('saved_profiles')
      .select('id')
      .eq('owner_id', viewerId)
      .eq('saved_profile_id', profileId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          reportSupabaseError('useIsProfileSaved.read', error, { profileId })
          logger.warn('Failed to read saved_profiles state', error)
          setIsSaved(false)
        } else {
          setIsSaved(Boolean(data))
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewerId, profileId, isOwnProfile])

  const toggle = useCallback(async () => {
    if (!viewerId) {
      addToast('Sign in to save players', 'error')
      return
    }
    if (!profileId || isOwnProfile || mutating) return

    setMutating(true)

    try {
      if (isSaved) {
        const { error } = await supabase
          .from('saved_profiles')
          .delete()
          .eq('owner_id', viewerId)
          .eq('saved_profile_id', profileId)

        if (error) {
          reportSupabaseError('useIsProfileSaved.unsave', error, { profileId })
          addToast('Could not remove from saved', 'error')
          return
        }

        setIsSaved(false)
      } else {
        const { error } = await supabase
          .from('saved_profiles')
          .insert({ owner_id: viewerId, saved_profile_id: profileId })

        if (error) {
          reportSupabaseError('useIsProfileSaved.save', error, { profileId })
          addToast('Could not save player', 'error')
          return
        }

        setIsSaved(true)
        addToast('Saved — see Saved Candidates in your dashboard', 'success')
      }
    } finally {
      setMutating(false)
    }
  }, [viewerId, profileId, isSaved, isOwnProfile, mutating, addToast])

  return {
    isSaved,
    loading,
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
