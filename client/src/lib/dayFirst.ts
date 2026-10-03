import { format } from 'date-fns'

/**
 * Day-first dates, app-wide (founder rule, QA round 7 re-check): "3 Oct",
 * "3 Oct 2026". Every date a person reads outside the signing road goes
 * through `dayFirst`; the road and the offer card keep lib/signing
 * `shortDayOf` / `longDay`, which produce the same shape. Month-only dates
 * ("Oct 2026") are not covered here and stay as they are.
 *
 * Admin charts (features/admin) and EmailActionPage are out of scope.
 */

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface DayFirstOptions {
  /**
   * 'auto' (default): the year only once it differs from `now`'s.
   * 'always': "3 Oct 2026" every time. 'never': "3 Oct" every time.
   */
  year?: 'auto' | 'always' | 'never'
  now?: Date
}

/**
 * A date-only string ("2026-10-03") is a calendar day: read it as a LOCAL
 * day so it never shifts by a timezone. Anything else is a timestamp, shown
 * in local time.
 */
export function parseDayFirst(input: string | Date | null | undefined): Date | null {
  if (!input) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim())
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "3 Oct" / "3 Oct 2026"; null for nothing or an unreadable date. */
export function dayFirst(input: string | Date | null | undefined, opts: DayFirstOptions = {}): string | null {
  const d = parseDayFirst(input)
  if (!d) return null
  const year = opts.year ?? 'auto'
  const now = opts.now ?? new Date()
  const withYear = year === 'always' || (year === 'auto' && d.getFullYear() !== now.getFullYear())
  const dayMonth = `${d.getDate()} ${MONTH[d.getMonth()]}`
  return withYear ? `${dayMonth} ${d.getFullYear()}` : dayMonth
}

/**
 * The ONE clock in the app: "10:04 AM" — what the chat bubbles show
 * (features/chat-v2 MessageBubble) and what the inbox list shows for today's
 * rows (QA round 7 re-check: the list said "10:04", the bubbles "10:04 AM").
 */
export function clockTime(input: string | Date | null | undefined): string {
  const d = parseDayFirst(input)
  return d ? format(d, 'h:mm a') : ''
}
