/**
 * CohortRetention — the two campaign-referee metrics (P6):
 *   · Week-2 return per signup-week cohort × acquisition source (Supabase
 *     `events` table — exact, bot/test-free; a returner has any event in
 *     days 7–13 after signup). Blended averages lie once a campaign wave
 *     lands; cohorts don't.
 *   · Global median time-to-first-response (the P1 value metric; same
 *     clean-by-construction rules as the responsiveness badge).
 */

import { useEffect, useState } from 'react'
import { Users2, Timer, AlertTriangle } from 'lucide-react'
import { getSignupCohortRetention, getResponseTimeStats } from '../api/adminApi'
import type { CohortRetentionRow, ResponseTimeStats } from '../types'
import { logger } from '@/lib/logger'

function formatHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 48) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function CohortRetention() {
  const [rows, setRows] = useState<CohortRetentionRow[] | null>(null)
  const [stats, setStats] = useState<ResponseTimeStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSignupCohortRetention(12), getResponseTimeStats()])
      .then(([cohorts, responseStats]) => {
        if (cancelled) return
        setRows(cohorts)
        setStats(responseStats)
      })
      .catch((err) => {
        logger.error('[CohortRetention] load failed', err)
        if (!cancelled) setError('Could not load cohort metrics.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Cohorts younger than 14 days can't have a final week-2 number yet.
  const maturityCutoff = new Date(Date.now() - 14 * 86_400_000)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Users2 className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-gray-900">Week-2 cohort return · by signup week &amp; source</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Returner = any activity in days 7–13 after signup. Exact (Supabase events, test accounts excluded).
      </p>

      {error && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {stats && (
        <div className="flex items-center gap-2 mb-4 bg-gray-50 rounded-xl p-3">
          <Timer className="w-4 h-4 text-emerald-600" />
          <span className="text-sm text-gray-700">
            Median time-to-first-response:{' '}
            <strong className="text-gray-900">{formatHours(stats.median_hours)}</strong>
            <span className="text-gray-400"> · {stats.responses_measured} responses measured · {stats.publishers_with_badge} publishers hold a badge ({stats.tier_fast} ⚡ / {stats.tier_week} week / {stats.tier_two_weeks} two-weeks)</span>
          </span>
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="text-sm text-gray-400">No signups in the window yet.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-4">Cohort week</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4 text-right">Signups</th>
                <th className="py-2 pr-4 text-right">Week-2 return</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const immature = new Date(r.cohort_week) > maturityCutoff
                return (
                  <tr key={`${r.cohort_week}-${r.acquisition_source}`} className="border-b border-gray-50">
                    <td className="py-2 pr-4 text-gray-700">{r.cohort_week}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.acquisition_source}</td>
                    <td className="py-2 pr-4 text-right text-gray-900">{r.signups}</td>
                    <td className="py-2 pr-4 text-right">
                      {immature ? (
                        <span className="text-gray-400" title="Cohort younger than 14 days — week-2 not final">
                          {r.week2_returners} · pending
                        </span>
                      ) : (
                        <span className="font-medium text-gray-900">
                          {r.week2_pct}% <span className="text-gray-400 font-normal">({r.week2_returners})</span>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
