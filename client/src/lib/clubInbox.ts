import { identityLine, positionLabel } from '@/lib/identity'
import { DEFAULT_EXPIRY_DAYS, daysLeftToReply, isDaysLeftUrgent } from '@/lib/clubRecruiting'

/**
 * Club v2 Home, Inbox and Chat (Figma D1.18 352:1290, D1.19 353:502,
 * D1.20 353:718, D1.21 353:809). Club-facing only: nothing here reaches a
 * player surface (founder ruling: club reminders go to clubs only).
 */

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

// ── Home · Your week (DEV NOTE 355:910) ──────────────────────────────────
export interface WeekStat { value: number; label: string; to?: string; accent?: boolean }

export function clubWeekStats({ toReview, views, openRoles }: { toReview: number; views: number; openRoles: number }): WeekStat[] {
  return [
    { value: toReview, label: 'to review', to: '/opportunities', accent: true },
    { value: views, label: views === 1 ? 'profile view' : 'profile views', to: '/pulse' },
    { value: openRoles, label: openRoles === 1 ? 'open role' : 'open roles', to: '/opportunities' },
  ]
}

// ── Inbox (DEV NOTE 355:914) ─────────────────────────────────────────────
/** "Player · Forward · Applied" — the role line, plus "Applied" when the
 *  person applied to any of the club's roles. */
export function clubInboxRoleLine(role: string | null | undefined, detail: string | null | undefined, applied: boolean): string {
  const base = identityLine(role, detail)
  return applied ? `${base} · Applied` : base
}

/** The amber notice: people the club has never written to. Hidden at 0. */
export function inboxWaitingNotice(rows: { waiting: boolean; applied: boolean }[]): { title: string; sub: string | null } | null {
  const waiting = rows.filter((r) => r.waiting)
  const n = waiting.length
  if (n === 0) return null
  const applied = waiting.filter((r) => r.applied).length
  const title = n === 1 ? '1 person waiting for a first reply' : `${n} people waiting for a first reply`
  const sub = applied === 0
    ? null
    : applied === n
      ? (n === 1 ? 'They applied to your roles.' : 'All of them applied to your roles.')
      : `${applied} of them applied to your roles.`
  return { title, sub }
}

/** Inbox › Requests label: clubs see the count (Figma D1.19), players a dot. */
export function requestsLabel(isClubV2: boolean, incoming: number): string {
  return isClubV2 && incoming > 0 ? `Requests · ${incoming}` : 'Requests'
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
}

/** The application the chat talks about: one still waiting first (the one
 *  closing soonest), otherwise the most recent. */
export function pickApplication(apps: ClubApplication[]): ClubApplication | null {
  if (!apps.length) return null
  const pending = apps.filter((a) => a.status === 'pending').sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
  if (pending.length) return pending[0]
  return [...apps].sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))[0]
}

/** "Applied to Midfielder · Men's 1st player". */
export function applicationCardTitle(app: Pick<ClubApplication, 'roleTitle' | 'rolePosition'>): string {
  const pos = positionLabel(app.rolePosition)
  const title = app.roleTitle?.trim() || null
  const parts = pos && title && title.toLowerCase() === pos.toLowerCase() ? [pos] : [pos, title].filter(Boolean)
  return parts.length ? `Applied to ${parts.join(' · ')}` : 'Applied to one of your roles'
}

const STATUS_NOTE: Record<string, string> = {
  shortlisted: 'shortlisted',
  maybe: 'marked maybe',
  rejected: 'declined',
  withdrawn: 'withdrawn by the player',
  offered: 'offer sent',
  accepted: 'offer accepted',
  signed_pending_confirmation: 'signing to confirm',
  signed: 'signed',
  offer_declined: 'offer declined',
  filled: 'role filled',
}

/** "Sep 17 · 8 days left to reply" / "Sep 3 · closed without a reply on Sep 18".
 *  urgent (amber) only while the club still has to act and ≤5 days are left. */
export function applicationCardDetail(app: ClubApplication, expiryDays = DEFAULT_EXPIRY_DAYS, now = new Date()): { text: string; urgent: boolean } {
  const applied = monthDay(app.appliedAt)
  const join = (tail: string | null) => [applied, tail].filter(Boolean).join(' · ')
  if (app.status === 'pending') {
    const days = daysLeftToReply(app.appliedAt, expiryDays, now)
    const tail = days === null ? null : days === 0 ? 'closes today' : days === 1 ? '1 day left to reply' : `${days} days left to reply`
    return { text: join(tail), urgent: isDaysLeftUrgent(days) }
  }
  if (app.status === 'no_response') {
    const closed = monthDay(app.updatedAt)
    return { text: join(closed ? `closed without a reply on ${closed}` : 'closed without a reply'), urgent: false }
  }
  return { text: join(STATUS_NOTE[app.status] ?? null), urgent: false }
}

/** Empty new chat with an applicant (D1.21). */
export const APPLICANT_CHAT_EMPTY = { title: 'No messages yet', body: 'A short hello goes a long way — most applicants never hear back.' }
