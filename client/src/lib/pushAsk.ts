import { useEffect, useReducer } from 'react'

/**
 * The notification ask (design audit 2026-10-21, Batch A1, founder approved).
 *
 * The "Stay in the loop" sheet is shown ONCE per member, and only right after
 * a moment of intent: a successful Apply, posting a role, or sending a first
 * message. It is never a floating card over a screen (it used to cover the
 * sticky Apply / Add friend / Shortlist bars). Once shown, turned on or
 * dismissed, it never comes back for that member on this device.
 *
 * Moments are in-memory (a fresh session never opens with the ask); the
 * "done" flag is per member in localStorage. There is no server preference
 * for this today.
 */
export type PushAskMoment = 'apply' | 'role_posted' | 'first_message'

const DONE_KEY_PREFIX = 'hockia-push-ask-done:'

let pending: PushAskMoment | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** A moment of intent happened: the ask may show (if it hasn't for this member). */
export function requestPushAsk(moment: PushAskMoment): void {
  pending = moment
  emit()
}

/** The ask was handled (shown or skipped): forget the pending moment. */
export function clearPushAsk(): void {
  if (pending === null) return
  pending = null
  emit()
}

function doneKey(userId: string) {
  return `${DONE_KEY_PREFIX}${userId}`
}

/** True once this member has seen the ask (turned on, Not now, or closed it). */
export function pushAskDone(userId: string | null | undefined): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(doneKey(userId)) === '1'
  } catch {
    // Storage blocked: never nag. Treat as done.
    return true
  }
}

/** Records that this member has seen the ask; it never shows again. */
export function markPushAskDone(userId: string | null | undefined): void {
  if (!userId) return
  try {
    localStorage.setItem(doneKey(userId), '1')
  } catch {
    /* storage blocked: pushAskDone already reads as done */
  }
}

export interface PushAskGate {
  moment: PushAskMoment | null
  done: boolean
  supported: boolean
  subscribed: boolean
  permission: string
  signedIn: boolean
  onboarded: boolean
  onHiddenRoute: boolean
  /** Another overlay (Terms, cookies, install, an in-page ask) is up. */
  otherOverlay: boolean
}

/** Whether the ask sheet should open now. Pure, for tests. */
export function shouldShowPushAsk(g: PushAskGate): boolean {
  return (
    g.moment !== null &&
    !g.done &&
    g.supported &&
    !g.subscribed &&
    g.permission !== 'denied' &&
    g.permission !== 'granted' &&
    g.signedIn &&
    g.onboarded &&
    !g.onHiddenRoute &&
    !g.otherOverlay
  )
}

/** Reactive read of the pending moment. */
export function usePendingPushAsk(): PushAskMoment | null {
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])
  return pending
}

/** Test helper: reset module state. */
export function __resetPushAskForTests(): void {
  pending = null
  emit()
}
