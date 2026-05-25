/**
 * FeatureAdoptionMatrix — Phase 3D
 *
 * Renders the feature × role adoption heatmap from
 * admin_get_feature_adoption. Rows are features (10 pinned ones from
 * the RPC), columns are roles (player / coach / club / brand / umpire),
 * each cell shows adoption_pct shaded by intensity.
 *
 * One use: spot "every role except brand uses Browse opportunities" or
 * "post_create is dead for clubs" without scanning a wall of numbers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { getFeatureAdoption, type FeatureAdoptionRow } from '../api/adminApi'
import { logger } from '@/lib/logger'

interface FeatureAdoptionMatrixProps {
  /** Window in days for the adoption calculation. Defaults to 30. */
  days?: number
}

const ROLE_ORDER = ['player', 'coach', 'club', 'brand', 'umpire'] as const

function pctToBg(pct: number): string {
  // 0 → light gray; 100 → deep purple. Five-stop scale matches the
  // existing role-tile colour palette so the matrix doesn't feel
  // visually disconnected.
  if (pct < 1) return 'bg-gray-50 text-gray-400'
  if (pct < 10) return 'bg-purple-50 text-gray-700'
  if (pct < 25) return 'bg-purple-100 text-purple-800'
  if (pct < 50) return 'bg-purple-300 text-purple-900'
  if (pct < 75) return 'bg-purple-500 text-white'
  return 'bg-purple-700 text-white'
}

export function FeatureAdoptionMatrix({ days = 30 }: FeatureAdoptionMatrixProps) {
  const [rows, setRows] = useState<FeatureAdoptionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getFeatureAdoption(days)
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => {
        logger.error('[FeatureAdoptionMatrix] fetch failed:', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setRows([])
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [days])

  useEffect(() => {
    const cancel = fetchData()
    return cancel
  }, [fetchData])

  // Pivot to feature × role lookup. Keys are stable so the table
  // ordering matches the RPC's pinned feature order.
  const { features, lookup, activeByRole } = useMemo(() => {
    const features: Array<{ key: string; label: string }> = []
    const seen = new Set<string>()
    const lookup = new Map<string, number>() // key: `${feature_key}|${role}` -> pct
    const activeByRole = new Map<string, number>()
    for (const r of rows) {
      if (!seen.has(r.feature_key)) {
        features.push({ key: r.feature_key, label: r.feature_label })
        seen.add(r.feature_key)
      }
      lookup.set(`${r.feature_key}|${r.role}`, Number(r.adoption_pct))
      activeByRole.set(r.role, Number(r.active_users_in_role))
    }
    return { features, lookup, activeByRole }
  }, [rows])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Feature Adoption</h2>
            <p className="text-sm text-gray-600 mt-1 break-words">Couldn&apos;t load this panel: {error}</p>
            <button
              type="button"
              onClick={() => fetchData()}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 hover:text-purple-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-400">No feature usage in the last {days} days.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Feature Adoption</h2>
        <p className="text-sm text-gray-500 mt-1">
          % of active users in each role who used the feature in the last {days} days.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Feature</th>
              {ROLE_ORDER.map((role) => (
                <th
                  key={role}
                  className="text-center py-3 px-4 font-medium text-gray-500 capitalize"
                >
                  {role}
                  <div className="text-xs font-normal text-gray-400">
                    {activeByRole.get(role) ?? 0} active
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.key} className="border-b border-gray-100 last:border-0">
                <td className="py-3 px-4 text-gray-800">{f.label}</td>
                {ROLE_ORDER.map((role) => {
                  const pct = lookup.get(`${f.key}|${role}`) ?? 0
                  return (
                    <td key={role} className="py-2 px-2">
                      <div
                        className={`px-2 py-2 rounded text-center text-xs font-mono ${pctToBg(pct)}`}
                        title={`${pct}% of active ${role}s in the last ${days} days`}
                      >
                        {pct.toFixed(0)}%
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
