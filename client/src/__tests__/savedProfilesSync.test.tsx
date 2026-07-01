/**
 * Saved-ids sync contract (P3 audit fix).
 *
 * The card "Saved" heart reads its filled/empty state from the shared
 * saved-ids store. Shortlist mutations that write to saved_profiles through
 * a path OTHER than useIsProfileSaved.toggle (add/remove a player in a list,
 * delete a whole list) must keep that store in sync, or the heart goes stale
 * until a remount refetches. These lock the imperative sync helpers that
 * useShortlists now calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// supabase.from('saved_profiles').select(...).eq(...) must be awaitable.
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(function (this: unknown) {
      builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve)
      return builder
    }),
  }
  return { supabase: { from: () => builder } }
})

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ profile: { id: 'viewer-1', role: 'club' } }),
}))
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))

import {
  useIsProfileSaved,
  markSavedProfileId,
  unmarkSavedProfileId,
  resyncSavedProfileIds,
} from '@/hooks/useSavedProfiles'

describe('saved-ids sync helpers drive the card heart', () => {
  beforeEach(() => {
    // Reset the module singleton to an empty, unowned state between cases.
    resyncSavedProfileIds()
  })

  it('markSavedProfileId fills the heart; unmarkSavedProfileId clears it', async () => {
    const { result } = renderHook(() => useIsProfileSaved('player-9'))

    // Initial one-shot fetch resolves to an empty set → not saved.
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSaved).toBe(false)

    // Adding the player to a list (from ShortlistDetail / MoveToShortlistMenu)
    // must flip the heart without a refetch.
    act(() => markSavedProfileId('player-9'))
    expect(result.current.isSaved).toBe(true)

    // Removing their only saved row (or deleting the list) must clear it.
    act(() => unmarkSavedProfileId('player-9'))
    expect(result.current.isSaved).toBe(false)
  })

  it('only touches the targeted id (other cards unaffected)', async () => {
    const other = renderHook(() => useIsProfileSaved('player-A'))
    await waitFor(() => expect(other.result.current.loading).toBe(false))

    act(() => markSavedProfileId('player-B'))
    // player-A was never touched.
    expect(other.result.current.isSaved).toBe(false)
  })
})
