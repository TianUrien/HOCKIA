/**
 * Deferred storage cleanup — regression for a LIVE production incident.
 *
 * 2026-07-30: a real player's avatar rendered broken across the app. Cause:
 * every "replace an image" flow uploaded the new file, updated only local
 * component state, and immediately DELETED the old file from storage — while
 * the database write happens later, on save. Abandon the form (close the
 * modal, navigate away, lose connectivity) and the row is left pointing at a
 * file that no longer exists. Permanently broken, deterministic, not a race.
 *
 * These tests pin the contract that prevents it: nothing is deleted until
 * the caller confirms the database write succeeded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

type DeleteArg = { bucket: string; publicUrl?: string | null; path?: string | null; context?: string }
const deleteStorageObject = vi.hoisted(() =>
  vi.fn<(args: DeleteArg) => Promise<boolean>>().mockResolvedValue(true),
)
vi.mock('@/lib/storage', () => ({ deleteStorageObject }))

import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'

const OLD = 'https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar_old.jpg'
const NEW = 'https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar_new.jpg'

describe('usePendingStorageCleanup', () => {
  beforeEach(() => deleteStorageObject.mockClear())

  it('does NOT delete on queue — only after flush (the incident)', async () => {
    const { result } = renderHook(() => usePendingStorageCleanup())

    act(() => {
      result.current.queue({ bucket: 'avatars', publicUrl: OLD, context: 'replace' })
    })
    // The user has uploaded a new avatar but has NOT saved yet. The profile
    // row still points at OLD, so OLD must still exist.
    expect(deleteStorageObject).not.toHaveBeenCalled()

    await act(async () => { await result.current.flush() })
    expect(deleteStorageObject).toHaveBeenCalledTimes(1)
    expect(deleteStorageObject).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'avatars', publicUrl: OLD }),
    )
  })

  it('abandoned edit deletes nothing — the old file survives', async () => {
    const { result, unmount } = renderHook(() => usePendingStorageCleanup())

    act(() => {
      result.current.queue({ bucket: 'avatars', publicUrl: OLD })
    })
    act(() => { result.current.discard() })
    unmount()

    expect(deleteStorageObject).not.toHaveBeenCalled()
  })

  it('A -> B -> A never deletes the URL the form will save', async () => {
    const { result } = renderHook(() => usePendingStorageCleanup())

    act(() => {
      result.current.queue({ bucket: 'avatars', publicUrl: OLD }) // uploaded NEW, replacing OLD
      result.current.queue({ bucket: 'avatars', publicUrl: NEW }) // re-uploaded OLD, replacing NEW
      result.current.unqueue(OLD)                                 // OLD is live again
    })
    await act(async () => { await result.current.flush() })

    const deleted = deleteStorageObject.mock.calls.map((c) => (c[0] as DeleteArg).publicUrl)
    expect(deleted).toEqual([NEW])
    expect(deleted).not.toContain(OLD)
  })

  it('flush is idempotent — a second save deletes nothing again', async () => {
    const { result } = renderHook(() => usePendingStorageCleanup())

    act(() => { result.current.queue({ bucket: 'avatars', publicUrl: OLD }) })
    await act(async () => { await result.current.flush() })
    await act(async () => { await result.current.flush() })

    expect(deleteStorageObject).toHaveBeenCalledTimes(1)
  })

  it('a failing delete never rejects — cleanup must not fail the save', async () => {
    deleteStorageObject.mockRejectedValueOnce(new Error('storage down'))
    const { result } = renderHook(() => usePendingStorageCleanup())

    act(() => { result.current.queue({ bucket: 'avatars', publicUrl: OLD }) })
    await act(async () => {
      await expect(result.current.flush()).resolves.toBeUndefined()
    })
  })
})
