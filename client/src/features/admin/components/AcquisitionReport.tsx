/**
 * AcquisitionReport — where signups actually come from, at a glance.
 *
 * Reads admin_get_acquisition_report: signups by normalized first-touch
 * channel with the change against the preceding equal-length period and
 * activation per channel. Rendered as a donut (share of new members) plus a
 * ranked legend, with a callout naming the leading IDENTIFIED source —
 * "direct" and "unknown" are shown honestly in grey but never crowned,
 * because neither is a channel you can invest in.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Compass, Trophy } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { colorForSources, displayGroup, displaySource, isNonChannel } from '@/lib/attributionLabels'

interface ChannelRow { source: string; group: string; signups: number; activated: number; prev_signups: number }
interface Report {
  period_days: number
  total_signups: number
  channels: ChannelRow[]
  methods: Record<string, number>
  confidence: Record<string, number>
  platforms: Record<string, number>
}

export function AcquisitionReport({ days = 90 }: { days?: number }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)('admin_get_acquisition_report', { p_days: days })
      .then(({ data, error: e }: { data: Report; error: { message: string } | null }) => {
        if (cancelled) return
        if (e) throw new Error(e.message)
        setReport(data)
        setError(null)
      })
      .catch((err: unknown) => {
        logger.error('[AcquisitionReport] load failed', err)
        if (!cancelled) setError('Could not load acquisition data.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const rows = useMemo(() => [...(report?.channels ?? [])].sort((a, b) => b.signups - a.signups), [report])
  const color = useMemo(() => colorForSources(rows.map((r) => r.source)), [rows])
  const total = report?.total_signups ?? 0
  const leader = rows.find((r) => !isNonChannel(r.source)) ?? null
  const identifiedTotal = rows.filter((r) => !isNonChannel(r.source)).reduce((n, r) => n + r.signups, 0)
  const measured = report ? Object.entries(report.methods)
    .filter(([m]) => m === 'utm' || m === 'referrer' || m === 'deep_link' || m === 'install_referrer')
    .reduce((n, [, v]) => n + v, 0) : 0

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5" data-testid="acquisition-report">
      <div className="flex items-center gap-2 mb-1">
        <Compass className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-gray-900">Acquisition — where new members come from</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Signups in the last {days} days by the first identifiable source that brought them. Auth providers are never a
        source; "unknown" means no evidence survived, "direct" means none existed.
      </p>

      {loading && <div data-testid="acquisition-loading" className="h-56 bg-gray-100 rounded-xl animate-pulse" />}
      {!loading && error && (
        <div data-testid="acquisition-error" className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {!loading && !error && report && total === 0 && (
        <div data-testid="acquisition-empty" className="text-sm text-gray-500">No signups in this window.</div>
      )}
      {!loading && !error && report && total > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 items-start">
            {/* Donut + leader */}
            <div>
              <div className="relative h-56" data-testid="acquisition-donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={rows.map((r) => ({ ...r, name: displaySource(r.source) }))}
                      dataKey="signups"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={94}
                      paddingAngle={rows.length > 1 ? 2 : 0}
                      stroke="#ffffff"
                      strokeWidth={2}
                      startAngle={90}
                      endAngle={-270}
                      animationDuration={500}
                    >
                      {rows.map((r) => <Cell key={r.source} fill={color(r.source)} />)}
                    </Pie>
                    <Tooltip content={<DonutTip total={total} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-gray-900 tabular-nums">{total}</span>
                  <span className="text-[11px] uppercase tracking-wider text-gray-500">new members</span>
                </div>
              </div>

              <div
                className={`mt-3 rounded-xl p-3 border ${leader ? 'border-purple-100 bg-purple-50/60' : 'border-gray-100 bg-gray-50'}`}
                data-testid="acquisition-leader"
              >
                {leader ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-purple-700">
                      <Trophy className="w-3.5 h-3.5" /> Leading source right now
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color(leader.source) }} />
                      <span className="text-base font-semibold text-gray-900">{displaySource(leader.source)}</span>
                      <span className="text-xs text-gray-500">{displayGroup(leader.group)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600 tabular-nums">
                      {leader.signups} of {total} signups ({Math.round((leader.signups / total) * 100)}%)
                      {' · '}
                      <Delta value={leader.signups - leader.prev_signups} /> vs previous {days}d
                      {' · '}
                      {leader.activated}/{leader.signups} activated
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {identifiedTotal} of {total} came through an identifiable channel.
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-600">
                    No identifiable source yet in this window — every signup was direct or unknown. Tagged links
                    (below) are how a source becomes visible here.
                  </div>
                )}
              </div>
            </div>

            {/* Ranked legend */}
            <div className="min-w-0">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[11px] uppercase tracking-wider text-gray-500 pb-2 border-b border-gray-100">
                <span>Source</span>
                <span className="text-right">Signups</span>
                <span className="text-right">vs prev</span>
                <span className="text-right">Activated</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {rows.map((c) => {
                  const share = c.signups / total
                  return (
                    <li key={c.source} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center py-2" data-testid={`acq-row-${c.source}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color(c.source) }} />
                          <span className={`truncate ${isNonChannel(c.source) ? 'text-gray-600' : 'font-medium text-gray-900'}`}>{displaySource(c.source)}</span>
                          <span className="text-xs text-gray-400 shrink-0">{displayGroup(c.group)}</span>
                          <span className="text-xs text-gray-500 tabular-nums shrink-0">{Math.round(share * 100)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, backgroundColor: color(c.source) }} />
                        </div>
                      </div>
                      <span className="text-sm text-right tabular-nums text-gray-900">{c.signups}</span>
                      <span className="text-sm text-right tabular-nums"><Delta value={c.signups - c.prev_signups} /></span>
                      <span className="text-sm text-right tabular-nums text-gray-600">{c.activated}/{c.signups}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-4">
            Measured (utm / referrer / deep link): {measured} of {total} ·
            inferred or backfilled: {total - measured} ·
            platforms: {Object.entries(report.platforms).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}
          </p>
        </>
      )}
    </div>
  )
}

function DonutTip({ active, payload, total }: { active?: boolean; payload?: Array<{ name?: string; value?: number }>; total: number }) {
  if (!active || !payload?.length) return null
  const { name, value = 0 } = payload[0]
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-gray-900">{name}</div>
      <div className="text-gray-600 tabular-nums">{value} signups · {total ? Math.round((value / total) * 100) : 0}%</div>
    </div>
  )
}

function Delta({ value }: { value: number }) {
  const cls = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-gray-400'
  return <span className={cls}>{value > 0 ? '+' : ''}{value}</span>
}
