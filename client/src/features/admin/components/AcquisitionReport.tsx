/**
 * AcquisitionReport — where signups actually come from.
 *
 * Reads admin_get_acquisition_report: signups by normalized first-touch
 * channel with the change against the preceding equal-length period,
 * activation per channel, and the method/confidence mix so an admin can see
 * how much of the picture is measured (utm / referrer) versus inferred
 * (backfill, platform default). "direct", "unknown" and store installs are
 * separate values — never merged.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Compass } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { displayGroup, displaySource } from '@/lib/attributionLabels'

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

  const measured = report ? Object.entries(report.methods)
    .filter(([m]) => m === 'utm' || m === 'referrer' || m === 'deep_link' || m === 'install_referrer')
    .reduce((n, [, v]) => n + v, 0) : 0

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5" data-testid="acquisition-report">
      <div className="flex items-center gap-2 mb-1">
        <Compass className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-gray-900">Acquisition — first-touch channel of new members</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Signups in the last {days} days by the first identifiable source that brought them. Auth providers are never a
        source; "unknown" means no evidence survived, "direct" means none existed.
      </p>

      {loading && <div data-testid="acquisition-loading" className="h-24 bg-gray-100 rounded-xl animate-pulse" />}
      {!loading && error && (
        <div data-testid="acquisition-error" className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {!loading && !error && report && report.total_signups === 0 && (
        <div data-testid="acquisition-empty" className="text-sm text-gray-500">No signups in this window.</div>
      )}
      {!loading && !error && report && report.total_signups > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Group</th>
                  <th className="py-2 pr-3 text-right">Signups</th>
                  <th className="py-2 pr-3 text-right">Share</th>
                  <th className="py-2 pr-3 text-right">vs prev</th>
                  <th className="py-2 text-right">Activated</th>
                </tr>
              </thead>
              <tbody>
                {report.channels.map((c) => {
                  const delta = c.signups - c.prev_signups
                  return (
                    <tr key={c.source} className="border-t border-gray-100" data-testid={`acq-row-${c.source}`}>
                      <td className="py-2 pr-3 font-medium text-gray-900">{displaySource(c.source)}</td>
                      <td className="py-2 pr-3 text-gray-500">{displayGroup(c.group)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.signups}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                        {Math.round((c.signups / report.total_signups) * 100)}%
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {delta > 0 ? '+' : ''}{delta}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-600">
                        {c.activated}/{c.signups}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Measured (utm / referrer / deep link): {measured} of {report.total_signups} ·
            inferred or backfilled: {report.total_signups - measured} ·
            platforms: {Object.entries(report.platforms).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}
          </p>
        </>
      )}
    </div>
  )
}
