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

/** Toast after a close — phone sheet and desktop tab share it. A club closing
 *  as filled hasn't necessarily signed through Hockia, so no congratulations:
 *  just what happened and that applicants were told (founder copy 2026-09-26). */
export function closeRoleToast(outcome: RoleCloseOutcome): string {
  return outcome === 'filled' ? 'Role closed as filled. Applicants have been told.' : 'Role closed.'
}
