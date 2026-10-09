/**
 * Close / reopen a role — the one mapping shared by the desktop close dialog
 * (OpportunitiesTab) and the phone role menu (Club v2).
 *
 * Close writes status 'closed' + closed_reason. "Filled" and "Not filled / no
 * longer needed" map to the existing closed_reason values 'filled' and
 * 'withdrawn'. filled_via_hockia is server-controlled ("Filled through
 * Hockia" comes only from a signing the player confirmed), so a close never
 * sends it.
 */
export type RoleCloseOutcome = 'filled' | 'withdrawn'

export interface RoleClosePatch {
  status: 'closed'
  closed_reason: RoleCloseOutcome
}

export function closeRolePatch(outcome: RoleCloseOutcome): RoleClosePatch {
  return { status: 'closed', closed_reason: outcome }
}

export interface RoleReopenPatch {
  status: 'open'
  closed_reason: null
  filled_via_hockia: null
  auto_closed_at: null
  closed_at: null
  application_deadline?: string
}

/**
 * Reopen restores publisher intent: clears the close fields and the hygiene
 * auto-close marker (a still-valid renewal-email token must not reopen a role
 * the club later closed), and when the deadline has already passed extends it
 * 30 days (mirrors apply_renewal_action) so the daily sweep doesn't re-close
 * it the next morning. Clearing filled_via_hockia is allowed by the server
 * guard; only setting it to true is refused.
 */
export function reopenRolePatch(applicationDeadline: string | null | undefined, now = new Date()): RoleReopenPatch {
  const patch: RoleReopenPatch = {
    status: 'open',
    closed_reason: null,
    filled_via_hockia: null,
    auto_closed_at: null,
    closed_at: null,
  }
  const today = now.toISOString().slice(0, 10)
  if (applicationDeadline && applicationDeadline.slice(0, 10) < today) {
    const extended = new Date(now)
    extended.setUTCDate(extended.getUTCDate() + 30)
    patch.application_deadline = extended.toISOString().slice(0, 10)
  }
  return patch
}

/** Applications still waiting on the club — the ones a close-as-filled moves to
 *  "Role filled" and notifies (public._fill_waiting_applications). */
export const WAITING_APPLICATION_STATUSES = ['pending', 'shortlisted', 'maybe', 'offered', 'accepted'] as const

/** Toast after a close — phone sheet and desktop tab share it. A club closing
 *  as filled hasn't necessarily signed through Hockia, so no congratulations:
 *  just what happened, and that applicants were told ONLY when some were still
 *  waiting (founder copy 2026-09-26; round 5: never claim it with 0). */
export function closeRoleToast(outcome: RoleCloseOutcome, waitingApplicants = 0): string {
  if (outcome !== 'filled') return 'Role closed.'
  return waitingApplicants > 0 ? 'Role closed as filled. Applicants have been told.' : 'Role closed as filled.'
}

/** Reopen toast — phone and desktop share it. */
export const REOPEN_ROLE_TOAST = 'Role reopened.'

/** The "not filled" close choice — phone and desktop share it. */
export const CLOSE_NOT_FILLED_LABEL = 'Not filled / no longer needed'

/** Applications that make a role undeletable: a confirmed signing (signed) or one
 *  waiting for the player to confirm. Same list as the BEFORE DELETE trigger
 *  on opportunities (20261009200000_club_flow_fixes.sql). */
export const SIGNING_LOCK_STATUSES = ['signed', 'signed_pending_confirmation'] as const

/** Founder copy 2026-10-09: why "Delete permanently" is off for such a role. */
export const ROLE_HAS_SIGNING_MESSAGE = 'This role has a confirmed signing, so it can’t be deleted. Close it instead.'

/** True when a delete was refused by the server because the role has a signing
 *  (P0001 from guard_opportunity_delete_with_signing). */
export function isRoleHasSigningError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const msg = String((err as { message?: unknown }).message ?? '')
  return /has a confirmed signing, so it can['’]t be deleted/.test(msg)
}
