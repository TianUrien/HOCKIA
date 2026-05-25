/**
 * ActivationByRoleCard — Phase 3E
 *
 * Per-role activation summary: cohort size, activated count + rate,
 * median time-to-first-value-action. Rendered as a small section on
 * AdminOverview right under the Activation Funnel — they answer
 * complementary questions:
 *   - Funnel: "of users at step N, how many got to N+1?"
 *   - This:   "of role X signups, how many ever acted, and how fast?"
 */

import { useEffect, useState } from 'react'
import { getTimeToFirstValue, type TimeToFirstValueRow } from '../api/adminApi'
import { logger } from '@/lib/logger'

function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) {
    const hrs = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
  }
  return `${Math.round(minutes / 1440)}d`
}

export function ActivationByRoleCard({ days = 90 }: { days?: number }) {
  const [rows, setRows] = useState<TimeToFirstValueRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getTimeToFirstValue(days)
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => {
        logger.error('[ActivationByRoleCard] fetch failed:', err)
        if (!cancelled) setRows([])
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [days])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Activation by Role</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Signups in the last {days} days who took a value-action (apply / message / post / friend request / reference / profile update).
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wider">
              <th className="text-left py-2 font-medium">Role</th>
              <th className="text-right py-2 font-medium">Cohort</th>
              <th className="text-right py-2 font-medium">Activated</th>
              <th className="text-right py-2 font-medium">Rate</th>
              <th className="text-right py-2 font-medium">Median time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratePct = r.cohort_size > 0
                ? Math.round((r.activated_count / r.cohort_size) * 100)
                : 0
              return (
                <tr key={r.role} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 text-gray-700 capitalize">{r.role}</td>
                  <td className="py-3 text-right text-gray-500 font-mono">{r.cohort_size}</td>
                  <td className="py-3 text-right text-gray-700 font-mono">{r.activated_count}</td>
                  <td className={`py-3 text-right font-semibold ${ratePct < 25 ? 'text-red-600' : ratePct < 50 ? 'text-amber-600' : 'text-green-600'}`}>
                    {ratePct}%
                  </td>
                  <td className="py-3 text-right text-gray-700 font-mono">
                    {formatDuration(r.median_minutes_to_first_action)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
