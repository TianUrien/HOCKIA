/**
 * Shared bits for the admin charts: the series palette (brand purple first,
 * then colours that stay apart on a white card), role colours that match the
 * role badges elsewhere in the admin, and the daily → weekly roll-up the bar
 * charts use so a 90-day window reads as 13 bars instead of 90.
 */
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

export const SERIES_COLORS = [HOCKIA_PRIMARY, '#0ea5e9', '#f59e0b', '#10b981', '#e11d48', '#6366f1', '#94a3b8'] as const

export const ROLE_COLORS: Record<string, string> = {
  player: '#8b5cf6',
  coach: '#3b82f6',
  club: '#f59e0b',
  umpire: '#6366f1',
  brand: '#e11d48',
  other: '#94a3b8',
}

export const ROLE_LABELS: Record<string, string> = {
  player: 'Players',
  coach: 'Coaches',
  club: 'Clubs',
  umpire: 'Umpires',
  brand: 'Brands',
  other: 'Other',
}

export interface WeeklyRow {
  /** ISO date of the Monday that starts the week. */
  week: string
  /** "6 Oct" style label for the axis. */
  label: string
  [key: string]: string | number
}

/** The Monday on or before `d`, as an ISO date (UTC, no time). */
export function weekStart(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export function shortDay(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Sum daily rows into calendar weeks (Monday start). `dateKey` names the
 * date field; every key in `sumKeys` is summed. Weeks come back in order and
 * the current, partial week is kept (the chart marks it).
 */
export function toWeekly<T extends object>(rows: readonly T[], dateKey: keyof T, sumKeys: readonly (keyof T)[]): WeeklyRow[] {
  const byWeek = new Map<string, WeeklyRow>()
  for (const row of rows) {
    const iso = String(row[dateKey])
    const week = weekStart(iso)
    let acc = byWeek.get(week)
    if (!acc) {
      acc = { week, label: shortDay(week) }
      for (const k of sumKeys) acc[String(k)] = 0
      byWeek.set(week, acc)
    }
    for (const k of sumKeys) acc[String(k)] = (acc[String(k)] as number) + (Number(row[k]) || 0)
  }
  return [...byWeek.values()].sort((a, b) => (a.week < b.week ? -1 : 1))
}

/** Share of a part in a whole as a whole-number percent, 0 when the whole is 0. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}
