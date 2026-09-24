import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Json } from '@/lib/database.types'

/**
 * Club decisions on an application (Figma 04 Club · Applicant review):
 * Shortlist / Maybe / Decline. After a decision the club lands back on
 * Applicants with "<Name> shortlisted · Undo" for 5 s.
 *
 * The write is HELD for that window, not written and reverted: a status
 * change fires the player notification, the status history and the queued
 * email, so an undo after the fact would still reach the player. Held
 * decisions commit when the window ends, and immediately if the page is
 * hidden or closed (the club switched apps), so a decision is never lost.
 */

export const UNDO_WINDOW_MS = 5000

export type Decision =
  | { kind: 'status'; applicationId: string; status: 'shortlisted' | 'maybe'; metadata: Json }
  | { kind: 'decline'; applicationId: string; reason: string; message: string }

type Held = { decision: Decision; timer: ReturnType<typeof setTimeout>; onDone?: (ok: boolean) => void }
const held = new Map<string, Held>()

async function commit(decision: Decision): Promise<boolean> {
  try {
    if (decision.kind === 'status') {
      const { error } = await supabase
        .from('opportunity_applications')
        .update({ status: decision.status, metadata: decision.metadata })
        .eq('id', decision.applicationId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.functions.invoke('application-feedback', {
        body: { mode: 'decline', application_id: decision.applicationId, reason: decision.reason, message: decision.message },
      })
      if (error || !(data as { ok?: boolean } | null)?.ok) throw error ?? new Error('decline_failed')
    }
    return true
  } catch (err) {
    logger.error('[pendingDecisions] commit failed', err)
    return false
  }
}

function release(applicationId: string) {
  const h = held.get(applicationId)
  if (!h) return
  clearTimeout(h.timer)
  held.delete(applicationId)
  void commit(h.decision).then((ok) => h.onDone?.(ok))
}

/** Hold a decision for the undo window, then write it. */
export function holdDecision(decision: Decision, onDone?: (ok: boolean) => void): void {
  // A second decision on the same application replaces the first.
  const prev = held.get(decision.applicationId)
  if (prev) clearTimeout(prev.timer)
  const timer = setTimeout(() => release(decision.applicationId), UNDO_WINDOW_MS)
  held.set(decision.applicationId, { decision, timer, onDone })
}

/** Undo: drop the held decision; nothing was written. Returns false if it already committed. */
export function undoDecision(applicationId: string): boolean {
  const h = held.get(applicationId)
  if (!h) return false
  clearTimeout(h.timer)
  held.delete(applicationId)
  return true
}

export function heldDecision(applicationId: string): Decision | null {
  return held.get(applicationId)?.decision ?? null
}

/** Write everything still held now (page hidden / unloading). */
export function flushDecisions(): void {
  for (const id of [...held.keys()]) release(id)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDecisions)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDecisions() })
}
