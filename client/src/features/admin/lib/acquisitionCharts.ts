/**
 * Pure helpers for the Overview's acquisition charts: the colour per
 * first-touch channel group (channels coloured, non-channels grey) and the
 * roll-up of admin_get_signups_by_channel_week rows into a donut and a
 * weekly stacked-bar series.
 */
import type { ChannelWeekRow } from '../types'
import { shortDay, weekStart } from './adminCharts'

/** Colours per channel group: channels get a colour, non-channels stay grey. */
export const CHANNEL_GROUP_COLORS: Record<string, string> = {
  social: '#6c2bd9',
  search: '#2563eb',
  store: '#059669',
  referral: '#d97706',
  email: '#e11d48',
  messaging: '#0891b2',
  ai_assistant: '#4f46e5',
  qr: '#65a30d',
  offline: '#db2777',
  other: '#0d9488',
  internal: '#94a3b8',
  direct: '#9ca3af',
  unknown: '#d1d5db',
}

const NON_CHANNEL = new Set(['direct', 'unknown'])

export interface ChannelSummary {
  /** Groups ordered by sign-ups, channels before non-channels. */
  groups: string[]
  totals: Record<string, number>
  total: number
  measured: number
  /** One row per week with a key per group; `partial` marks the current week. */
  weekly: Array<Record<string, string | number | boolean>>
}

/** Pure roll-up of the RPC rows into what the two charts need. */
export function summariseChannels(rows: readonly ChannelWeekRow[], today: string = new Date().toISOString().slice(0, 10)): ChannelSummary {
  const totals: Record<string, number> = {}
  let total = 0
  let measured = 0
  const byWeek = new Map<string, Record<string, string | number | boolean>>()
  const currentWeek = weekStart(today)
  for (const r of rows) {
    totals[r.channel_group] = (totals[r.channel_group] ?? 0) + r.signups
    total += r.signups
    measured += r.measured
    let w = byWeek.get(r.week)
    if (!w) {
      w = { week: r.week, label: shortDay(r.week), partial: r.week === currentWeek }
      byWeek.set(r.week, w)
    }
    w[r.channel_group] = ((w[r.channel_group] as number) ?? 0) + r.signups
  }
  const groups = Object.keys(totals).sort((a, b) => {
    const na = NON_CHANNEL.has(a) ? 1 : 0
    const nb = NON_CHANNEL.has(b) ? 1 : 0
    return na - nb || totals[b] - totals[a] || a.localeCompare(b)
  })
  const weekly = [...byWeek.values()].sort((a, b) => (String(a.week) < String(b.week) ? -1 : 1))
  for (const w of weekly) for (const g of groups) if (w[g] === undefined) w[g] = 0
  return { groups, totals, total, measured, weekly }
}
