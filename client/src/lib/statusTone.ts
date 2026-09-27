/**
 * Viewer-dependent status colours (founder rulings 2026-09-26).
 *
 * Amber means ONE thing: the person LOOKING at the screen must act soon.
 * The same status can therefore be amber for one viewer and grey for
 * another, so every decision here takes the viewer as input:
 *
 *   - "No reply · 14d+"      grey for the player (waiting on the club),
 *                            amber for the club (it owes the answer).
 *   - "Invitation pending"   grey in the club's squad / members — the club
 *                            waits on the invitee.
 *   - "Pending verification" grey for everyone except the person who must
 *                            verify (amber for them).
 *   - Trust (references, endorsements, "Trusted by") is gold, never amber.
 *
 * Colours come from the Foundations tokens in tailwind.config.js:
 * amber = amber-600 (#B45309) on #FDF1E4, grey = ink-2 on surface-grouped,
 * gold = gold / gold-soft / gold-line.
 */

export type StatusTone = 'amber' | 'grey' | 'gold'

/** Pill (background + text). */
export const STATUS_TONE_PILL: Record<StatusTone, string> = {
  amber: 'bg-[#fdf1e4] text-amber-600',
  grey: 'bg-surface-grouped text-ink-2',
  gold: 'bg-gold-soft text-gold',
}

/** Inline text only (captions, "Invitation pending" lines). */
export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  amber: 'text-amber-600',
  grey: 'text-ink-2',
  gold: 'text-gold',
}

/** Who is looking at an application's reply state. */
export type ReplyViewer = 'applicant' | 'club'

/** Days without a reply after which "No reply" shows (and turns amber for the club). */
export const NO_REPLY_DAYS = 14

/** "No reply · 14d+": grey for the applicant, amber for the club. */
export function noReplyTone(viewer: ReplyViewer): StatusTone {
  return viewer === 'club' ? 'amber' : 'grey'
}

/** "Invitation pending" in a club's squad / members: the club waits → grey. */
export function invitationPendingTone(): StatusTone {
  return 'grey'
}

/** "Pending verification": amber only for the person who must verify. */
export function pendingVerificationTone(viewerMustVerify: boolean): StatusTone {
  return viewerMustVerify ? 'amber' : 'grey'
}
