/**
 * Club speed CS8 · Your replies, last 30 days (Figma 05 204:1399).
 *
 * Real data only, from the publisher's own applications (never the
 * publisher_responsiveness view, which player surfaces must not read either).
 * An application that arrived in the last 30 days counts once its outcome is
 * known: answered (any decision the club took, or the role filled) or closed
 * without a reply (no_response). Still waiting = pending, not failed, so it
 * is left out; a withdrawal is the player's choice and is left out too.
 * Shown only from YOUR_REPLIES_MIN counted applicants. Neutral surface, no
 * comparisons with other clubs; Figma's one line after the count is kept
 * (founder ruling 2026-10-18).
 */
export const YOUR_REPLIES_DAYS = 30
export const YOUR_REPLIES_MIN = 5
export const REPLIES_NUDGE = 'Players remember the clubs that answer.'

const ANSWERED = new Set(['shortlisted', 'maybe', 'rejected', 'offered', 'accepted', 'signed_pending_confirmation', 'signed', 'filled'])
const UNANSWERED = new Set(['no_response'])

export interface YourReplies { answered: number; total: number; unanswered: number }

export function yourReplies(statuses: string[]): YourReplies | null {
  let answered = 0
  let unanswered = 0
  for (const s of statuses) {
    if (ANSWERED.has(s)) answered += 1
    else if (UNANSWERED.has(s)) unanswered += 1
  }
  const total = answered + unanswered
  return total >= YOUR_REPLIES_MIN ? { answered, total, unanswered } : null
}

export function yourRepliesCopy(r: YourReplies): { title: string; detail: string | null } {
  return {
    title: `You answered ${r.answered} of ${r.total} applicants`,
    // Founder ruling 2026-10-18: keep Figma's line after the count.
    detail: r.unanswered === 0 ? null : `${r.unanswered === 1 ? '1 closed' : `${r.unanswered} closed`} without a reply. ${REPLIES_NUDGE}`,
  }
}
