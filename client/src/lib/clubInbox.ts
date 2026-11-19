import { identityLine, positionLabel } from '@/lib/identity'
import { DEFAULT_EXPIRY_DAYS, daysLeftToReply, isDaysLeftUrgent } from '@/lib/clubRecruiting'
import { roleClosedLabel } from '@/lib/applicationStatus'
import { shortDayOf } from '@/lib/signing'
import { tInbox } from '@/i18n/ns/inbox'

/**
 * Club v2 Home, Inbox and Chat (Figma D1.18 352:1290, D1.19 353:502,
 * D1.20 353:718, D1.21 353:809). Club-facing only: nothing here reaches a
 * player surface (founder ruling: club reminders go to clubs only).
 */

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null | undefined) => shortDayOf(iso)

// ── Home · Your week (DEV NOTE 355:910) ──────────────────────────────────
export interface WeekStat { value: number; label: string; to?: string; accent?: boolean }

export function clubWeekStats({ toReview, views, openRoles }: { toReview: number; views: number; openRoles: number }): WeekStat[] {
  return [
    { value: toReview, label: tInbox('clubInbox.week.toReview'), to: '/opportunities', accent: true },
    { value: views, label: tInbox('clubInbox.week.views', { count: views }), to: '/pulse' },
    { value: openRoles, label: tInbox('clubInbox.week.openRoles', { count: openRoles }), to: '/opportunities' },
  ]
}

// ── Inbox (DEV NOTE 355:914) ─────────────────────────────────────────────
/** "Player · Forward · Applied" — the role line, plus "Applied" when the
 *  person applied to any of the club's roles. */
export function clubInboxRoleLine(role: string | null | undefined, detail: string | null | undefined, applied: boolean): string {
  const base = identityLine(role, detail)
  return applied ? tInbox('clubInbox.roleLineApplied', { base, applied: tInbox('clubInbox.applied') }) : base
}

/** The amber notice: people the club has never written to. Hidden at 0. */
export function inboxWaitingNotice(rows: { waiting: boolean; applied: boolean }[]): { title: string; sub: string | null } | null {
  const waiting = rows.filter((r) => r.waiting)
  const n = waiting.length
  if (n === 0) return null
  const applied = waiting.filter((r) => r.applied).length
  const title = tInbox('clubInbox.waitingTitle', { count: n })
  const sub = applied === 0
    ? null
    : applied === n
      ? (n === 1 ? tInbox('clubInbox.waitingSubOne') : tInbox('clubInbox.waitingSubAll'))
      : tInbox('clubInbox.waitingSubSome', { count: applied })
  return { title, sub }
}

// ── Chat context card (DEV NOTES 355:919, 355:923) ───────────────────────
export interface ClubApplication {
  id: string
  opportunityId: string
  status: string
  appliedAt: string | null
  updatedAt: string | null
  roleTitle: string | null
  rolePosition: string | null
  /** The role's status; a pending application on a role that isn't open no
   *  longer waits on the club (founder, QA round 9). Absent → treated as open. */
  roleStatus?: string | null
}

/** Still waiting on the club: pending AND the role is open. */
function pendingOnOpenRole(a: Pick<ClubApplication, 'status' | 'roleStatus'>): boolean {
  return a.status === 'pending' && (a.roleStatus == null || a.roleStatus === 'open')
}

/** The application the chat talks about: one still waiting first (pending on
 *  an open role, the one closing soonest), otherwise the most recent. */
export function pickApplication(apps: ClubApplication[]): ClubApplication | null {
  if (!apps.length) return null
  const pending = apps.filter(pendingOnOpenRole).sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
  if (pending.length) return pending[0]
  return [...apps].sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))[0]
}

/** "Applied to Midfielder · Men's 1st player". */
export function applicationCardTitle(app: Pick<ClubApplication, 'roleTitle' | 'rolePosition'>): string {
  const pos = positionLabel(app.rolePosition)
  const title = app.roleTitle?.trim() || null
  const parts = pos && title && title.toLowerCase() === pos.toLowerCase() ? [pos] : [pos, title].filter(Boolean)
  return parts.length ? tInbox('clubInbox.cardTitle', { role: parts.join(', ') }) : tInbox('clubInbox.cardTitleNone')
}

const STATUS_NOTE_KEYS = new Set([
  'shortlisted', 'maybe',
  'rejected', // the club's own word (founder 2026-10-25), never "declined"
  'withdrawn', 'offered', 'accepted', 'signed_pending_confirmation', 'signed', 'offer_declined', 'filled',
])
const statusNote = (status: string): string | null =>
  STATUS_NOTE_KEYS.has(status) ? tInbox(`clubInbox.status.${status}` as 'clubInbox.status.signed') : null

/** "Sep 17 · 8 days left to reply" / "Sep 3 · closed without a reply on Sep 18".
 *  urgent (amber) only while the club still has to act and ≤5 days are left. */
export function applicationCardDetail(app: ClubApplication, expiryDays = DEFAULT_EXPIRY_DAYS, now = new Date()): { text: string; urgent: boolean } {
  const applied = monthDay(app.appliedAt)
  const join = (tail: string | null) => [applied, tail].filter(Boolean).join(', ')
  if (app.status === 'pending' && !pendingOnOpenRole(app)) return { text: join(roleClosedLabel()), urgent: false }
  if (app.status === 'pending') {
    const days = daysLeftToReply(app.appliedAt, expiryDays, now)
    const tail = days === null ? null : days === 0 ? tInbox('clubInbox.closesToday') : tInbox('clubInbox.daysLeft', { count: days })
    return { text: join(tail), urgent: isDaysLeftUrgent(days) }
  }
  if (app.status === 'no_response') {
    const closed = monthDay(app.updatedAt)
    return { text: join(closed ? tInbox('clubInbox.closedOn', { day: closed }) : tInbox('clubInbox.closed')), urgent: false }
  }
  return { text: join(statusNote(app.status)), urgent: false }
}

/** Empty new chat with an applicant (D1.21). */
export function applicantChatEmpty(): { title: string; body: string } {
  return { title: tInbox('clubInbox.emptyTitle'), body: tInbox('clubInbox.emptyBody') }
}
