/**
 * Visas & work permits (D2 · 30-second profile). Pure helpers — no I/O.
 *
 * Mirrors public.work_permit_status() in
 * supabase/migrations/20260928200000_d2_player_work_permits.sql. Keep the two
 * in sync: the server uses it for the completeness bonus, the client for the
 * amber "expires soon" row on the owner's profile and permits screen.
 *
 * Founder rulings 2026-09-26: permits are SHOWN, never enforced (application
 * eligibility stays EU-passport only); details are visible to the owner and to
 * recruiters only (RLS); expiry is an amber row for the owner, no email/push.
 * Expiry is optional for every type: a permit with no expiry is valid (never
 * expiring soon / expired); a future start date still makes it not yet valid.
 */

export const WORK_PERMIT_TYPES = ['visa', 'work_permit', 'residency'] as const
export type WorkPermitType = (typeof WORK_PERMIT_TYPES)[number]

export const WORK_PERMIT_TYPE_LABELS: Record<WorkPermitType, string> = {
  visa: 'Visa',
  work_permit: 'Work permit',
  residency: 'Residency',
}

/** A permit expiring within this many days (still valid) is "expiring soon". */
export const EXPIRING_SOON_DAYS = 30

/** Max permits per player (server guard: guard_player_work_permit_client_write). */
export const MAX_WORK_PERMITS = 10

export type WorkPermitStatus = 'valid' | 'expiring_soon' | 'expired' | 'not_yet_valid'

export interface WorkPermitRow {
  id: string
  player_id: string
  country_id: number
  type: string
  valid_from: string | null
  expires_on: string | null
  created_at: string
  updated_at: string
}

export function isWorkPermitType(value: unknown): value is WorkPermitType {
  return typeof value === 'string' && (WORK_PERMIT_TYPES as readonly string[]).includes(value)
}

export function workPermitTypeLabel(type: string | null | undefined): string {
  return isWorkPermitType(type) ? WORK_PERMIT_TYPE_LABELS[type] : 'Permit'
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' → UTC day number, or null when the string isn't a date. */
function dayNumber(iso: string | null | undefined): number | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS)
}

/** Today's UTC calendar day (the server compares against the UTC date too). */
function todayNumber(today: Date): number {
  return Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / DAY_MS)
}

/** Same rules as public.work_permit_status(valid_from, expires_on). */
export function workPermitStatus(
  validFrom: string | null | undefined,
  expiresOn: string | null | undefined,
  today: Date = new Date(),
): WorkPermitStatus {
  const expires = dayNumber(expiresOn)
  const now = todayNumber(today)
  if (expires !== null && expires < now) return 'expired'
  const from = dayNumber(validFrom)
  if (from !== null && from > now) return 'not_yet_valid'
  if (expires !== null && expires - now <= EXPIRING_SOON_DAYS) return 'expiring_soon'
  // No expiry (or none given) = valid.
  return 'valid'
}

/** Valid today (expiring soon still counts as valid). */
export function isWorkPermitValid(
  validFrom: string | null | undefined,
  expiresOn: string | null | undefined,
  today: Date = new Date(),
): boolean {
  const s = workPermitStatus(validFrom, expiresOn, today)
  return s === 'valid' || s === 'expiring_soon'
}

/** True when the owner should see the amber row (expiring soon or expired). */
export function needsPermitAttention(status: WorkPermitStatus): boolean {
  return status === 'expiring_soon' || status === 'expired'
}

export interface WorkPermitDraft {
  country_id: number | null
  type: string | null
  valid_from?: string | null
  /** Optional for every permit type. */
  expires_on?: string | null
}

export type WorkPermitDraftError = 'country_required' | 'type_invalid' | 'date_invalid' | 'dates_out_of_order'

/** Client-side check before a write (the table's CHECK constraints are the real guard). */
export function validateWorkPermitDraft(draft: WorkPermitDraft): WorkPermitDraftError | null {
  if (!draft.country_id) return 'country_required'
  if (!isWorkPermitType(draft.type)) return 'type_invalid'
  // Both dates are optional, but a date that is given must be a real date.
  const expiresGiven = typeof draft.expires_on === 'string' && draft.expires_on.trim() !== ''
  const fromGiven = typeof draft.valid_from === 'string' && draft.valid_from.trim() !== ''
  const expires = expiresGiven ? dayNumber(draft.expires_on) : null
  const from = fromGiven ? dayNumber(draft.valid_from) : null
  if ((expiresGiven && expires === null) || (fromGiven && from === null)) return 'date_invalid'
  if (from !== null && expires !== null && from > expires) return 'dates_out_of_order'
  return null
}

/** Valid permits first (soonest expiry first, no-expiry last), then not-yet-valid, then expired. */
export function sortWorkPermits<T extends Pick<WorkPermitRow, 'valid_from' | 'expires_on'>>(
  rows: readonly T[],
  today: Date = new Date(),
): T[] {
  const rank: Record<WorkPermitStatus, number> = { expiring_soon: 0, valid: 0, not_yet_valid: 1, expired: 2 }
  return [...rows].sort((a, b) => {
    const ra = rank[workPermitStatus(a.valid_from, a.expires_on, today)]
    const rb = rank[workPermitStatus(b.valid_from, b.expires_on, today)]
    if (ra !== rb) return ra - rb
    return (dayNumber(a.expires_on) ?? Number.MAX_SAFE_INTEGER) - (dayNumber(b.expires_on) ?? Number.MAX_SAFE_INTEGER)
  })
}
