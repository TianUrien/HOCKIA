import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase'
import { AUTH_STORAGE_KEY } from '@/lib/authStorageKey'
import { logger } from '@/lib/logger'
import type { Json } from '@/lib/database.types'
import { isWithdrawnApplicationError } from '@/lib/applicationStatus'

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
 *
 * On pagehide / beforeunload (reload, closed tab) the write goes out as a
 * keepalive request the browser finishes after the page is gone: the
 * supabase client's own fetch first awaits the session, and the page was
 * gone before it got there (QA 2 Oct: a reload during Undo lost the
 * shortlist).
 */

export const UNDO_WINDOW_MS = 5000

export type Decision =
  | { kind: 'status'; applicationId: string; status: 'shortlisted' | 'maybe'; metadata: Json }
  | { kind: 'decline'; applicationId: string; reason: string; message: string }

/** `withdrawn`: refused because the player withdrew the application. */
type OnDone = (ok: boolean, withdrawn?: boolean) => void
type Held = { decision: Decision; timer: ReturnType<typeof setTimeout>; onDone?: OnDone }
const held = new Map<string, Held>()

async function commit(decision: Decision): Promise<{ ok: boolean; withdrawn?: boolean }> {
  try {
    if (decision.kind === 'status') {
      const { data, error } = await supabase
        .from('opportunity_applications')
        .update({ status: decision.status, metadata: decision.metadata })
        .eq('id', decision.applicationId)
        .select('id')
      if (error) throw error
      // A withdrawn application can't be changed: clubs can only READ
      // withdrawn rows (D4 re-check), so the update matches no row — or the
      // guard trigger refuses it, which the catch below recognises.
      if (!data?.length) return { ok: false, withdrawn: true }
    } else {
      const { data, error } = await supabase.functions.invoke('application-feedback', {
        body: { mode: 'decline', application_id: decision.applicationId, reason: decision.reason, message: decision.message },
      })
      if (error || !(data as { ok?: boolean } | null)?.ok) throw error ?? new Error('decline_failed')
    }
    return { ok: true }
  } catch (err) {
    if (await isWithdrawnApplicationError(err)) return { ok: false, withdrawn: true }
    logger.error('[pendingDecisions] commit failed', err)
    return { ok: false }
  }
}

function release(applicationId: string) {
  const h = held.get(applicationId)
  if (!h) return
  clearTimeout(h.timer)
  held.delete(applicationId)
  void commit(h.decision).then((r) => h.onDone?.(r.ok, r.withdrawn))
}

/** Hold a decision for the undo window, then write it. */
export function holdDecision(decision: Decision, onDone?: OnDone): void {
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

/** The session's access token as supabase-js persisted it — read synchronously, for the unload path. */
function storedAccessToken(): string | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const token = (JSON.parse(raw) as { access_token?: unknown } | null)?.access_token
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

/** The same write as commit(), as one keepalive request (PostgREST PATCH / the feedback function). */
export function keepaliveRequest(decision: Decision, token: string): { url: string; init: RequestInit } {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (decision.kind === 'status') {
    return {
      url: `${SUPABASE_URL}/rest/v1/opportunity_applications?id=eq.${encodeURIComponent(decision.applicationId)}`,
      init: { method: 'PATCH', keepalive: true, headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ status: decision.status, metadata: decision.metadata }) },
    }
  }
  return {
    url: `${SUPABASE_URL}/functions/v1/application-feedback`,
    init: { method: 'POST', keepalive: true, headers, body: JSON.stringify({ mode: 'decline', application_id: decision.applicationId, reason: decision.reason, message: decision.message }) },
  }
}

function commitOnUnload(decision: Decision): boolean {
  const token = storedAccessToken()
  if (!token || typeof fetch !== 'function') return false
  try {
    const { url, init } = keepaliveRequest(decision, token)
    void fetch(url, init).catch((err: unknown) => logger.error('[pendingDecisions] keepalive commit failed', err))
    return true
  } catch (err) {
    logger.error('[pendingDecisions] keepalive commit failed', err)
    return false
  }
}

/**
 * Write everything still held now. `unloading` (pagehide / beforeunload):
 * fire-and-forget keepalive requests, since nothing async survives the
 * page; without a session to read, the normal write is still attempted.
 */
export function flushDecisions(opts: { unloading?: boolean } = {}): void {
  for (const id of [...held.keys()]) {
    if (!opts.unloading) { release(id); continue }
    const h = held.get(id)
    if (!h) continue
    clearTimeout(h.timer)
    held.delete(id)
    if (!commitOnUnload(h.decision)) void commit(h.decision).then((r) => h.onDone?.(r.ok, r.withdrawn))
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushDecisions({ unloading: true }))
  window.addEventListener('beforeunload', () => flushDecisions({ unloading: true }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDecisions() })
}
