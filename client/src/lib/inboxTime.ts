import { differenceInCalendarDays, format, isToday } from 'date-fns'

/**
 * Inbox row timestamps (app rule): the time today, the weekday within the
 * week, "Sep 12" before that (and the year once it differs). Short on
 * purpose — the row has one line for it.
 */
export function formatInboxTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (isToday(date)) return format(date, 'HH:mm')
  const days = differenceInCalendarDays(now, date)
  if (days < 7) return format(date, 'EEE')
  if (date.getFullYear() === now.getFullYear()) return format(date, 'MMM d')
  return format(date, 'MMM d, yyyy')
}

/** Feed and Activity rows (founder rule): "now / 4m / 2h / 3d / Sep 12" — never "ago". */
export function formatActivityAge(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}
