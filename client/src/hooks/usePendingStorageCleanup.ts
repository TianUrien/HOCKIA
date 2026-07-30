import { useRef, useCallback } from 'react'
import { deleteStorageObject } from '@/lib/storage'

type PendingDeletion = {
  bucket: string
  publicUrl?: string | null
  path?: string | null
  context?: string
}

/**
 * Deferred storage cleanup for replace-then-save flows.
 *
 * THE BUG THIS EXISTS TO PREVENT (found on prod 2026-07-30): every
 * "replace an image" flow used to upload the new file, update only LOCAL
 * component state, and then immediately DELETE the old file from storage —
 * while the database write happens later, when the user saves the form.
 *
 * So any user who picked a new photo and then closed the modal, navigated
 * away, lost connectivity, or simply never pressed Save was left with:
 *   - the old file: deleted from storage
 *   - the profile row: still pointing at that deleted file
 *   - result: a permanently broken image, unrecoverable without re-uploading
 *
 * That is exactly how a real player's avatar broke in production. It was
 * never a race — it is deterministic for anyone who abandons the form.
 *
 * The fix: queue() the old object at upload time, and only flush() it after
 * the database write succeeds. Abandoned edits leave an orphaned NEW file in
 * storage, which is invisible and cheap; the old file survives so the row
 * that still references it keeps rendering. Correctness over bytes.
 */
export function usePendingStorageCleanup() {
  const pending = useRef<PendingDeletion[]>([])

  /** Mark an object for deletion once the DB write succeeds. */
  const queue = useCallback((deletion: PendingDeletion) => {
    const target = deletion.publicUrl ?? deletion.path
    if (!target) return
    // Guard the A→B→A case: re-uploading a previously replaced URL must not
    // delete the object the form is about to save.
    pending.current = pending.current.filter(
      (p) => (p.publicUrl ?? p.path) !== target,
    )
    pending.current.push(deletion)
  }, [])

  /** Drop a queued deletion — the object is live again (form reverted to it). */
  const unqueue = useCallback((target: string | null | undefined) => {
    if (!target) return
    pending.current = pending.current.filter(
      (p) => (p.publicUrl ?? p.path) !== target,
    )
  }, [])

  /**
   * Delete every queued object. Call ONLY after the DB write succeeded.
   * Never throws — cleanup failure must not surface as a save failure, and
   * a leftover object is harmless.
   */
  const flush = useCallback(async () => {
    const toDelete = pending.current
    pending.current = []
    await Promise.all(
      toDelete.map((d) =>
        deleteStorageObject(d).catch(() => false),
      ),
    )
  }, [])

  /** Forget queued deletions without deleting (form cancelled). */
  const discard = useCallback(() => {
    pending.current = []
  }, [])

  return { queue, unqueue, flush, discard }
}
