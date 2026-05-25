/**
 * RoleHealthCard — Phase 3B + 3C
 *
 * Per-role profile-health summary: completeness histogram + top-N
 * missing fields. Rendered above each Users & Roles tab's existing
 * content so admins can see "what's the biggest single onboarding
 * lever for coaches" at a glance instead of clicking through to
 * the player-specific Profile Completeness section.
 *
 * The two RPCs are loaded in parallel on mount/role-change. Each
 * surface degrades independently — if the histogram fails, the
 * missing-fields block still renders, and vice versa.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import {
  getProfileCompletenessDistribution,
  getRoleMissingFields,
  type RoleMissingField,
} from '../api/adminApi'
import type { ProfileCompletenessDistribution } from '../types'
import { logger } from '@/lib/logger'

interface RoleHealthCardProps {
  /** 'player' | 'coach' | 'club' | 'brand' | 'umpire' */
  role: string
}

const BUCKET_COLOR_MAP: Record<string, string> = {
  '0-25%': 'bg-red-400',
  '26-50%': 'bg-amber-400',
  '51-75%': 'bg-blue-400',
  '76-100%': 'bg-green-500',
}

export function RoleHealthCard({ role }: RoleHealthCardProps) {
  const [distribution, setDistribution] = useState<ProfileCompletenessDistribution[]>([])
  const [missing, setMissing] = useState<RoleMissingField[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Track per-fetch errors so the card can show a real failure state
  // rather than silently falling back to empty (QA pass 2 observation:
  // silent failures looked like missing components, not broken ones).
  // Either RPC can fail independently — combining their errors is OK
  // since the user-facing remedy is the same (retry both).
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.all([
      getProfileCompletenessDistribution(role),
      getRoleMissingFields(role),
    ])
      .then(([dist, miss]) => {
        if (cancelled) return
        setDistribution(dist)
        setMissing(miss)
      })
      .catch((err) => {
        logger.error(`[RoleHealthCard] fetch failed for ${role}:`, err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setDistribution([])
          setMissing([])
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [role])

  useEffect(() => {
    const cancel = fetchData()
    return cancel
  }, [fetchData])

  const totalUsers = missing[0]?.total_role_users ?? distribution.reduce((sum, b) => sum + Number(b.count), 0)

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
        <div className="h-10 bg-gray-100 rounded-lg mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-gray-100 rounded" />
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
            <h2 className="text-lg font-semibold text-gray-900">Profile Health</h2>
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

  if (totalUsers === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-400">
          No {role}s yet — nothing to score.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Profile Health</h2>
        <span className="text-xs text-gray-500">{totalUsers} {role}s</span>
      </div>

      {/* Stacked horizontal bar for completeness distribution. Same
          visual idiom as the existing player-specific distribution
          block so muscle memory carries across role tabs. */}
      {distribution.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Completeness</p>
          <div className="h-8 bg-gray-100 rounded-lg overflow-hidden flex">
            {distribution.map((b) => (
              <div
                key={b.bucket}
                className={`${BUCKET_COLOR_MAP[b.bucket] ?? 'bg-gray-300'} transition-all flex items-center justify-center text-xs font-medium text-white first:rounded-l-lg last:rounded-r-lg`}
                style={{ width: `${Math.max(Number(b.percentage), 4)}%` }}
                title={`${b.bucket}: ${b.count} ${role}s (${b.percentage}%)`}
              >
                {Number(b.percentage) > 8 ? `${b.percentage}%` : ''}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1.5">
            {distribution.map((b) => (
              <span key={b.bucket}>{b.bucket}</span>
            ))}
          </div>
        </div>
      )}

      {/* Top missing fields. Sorted server-side by null_count DESC so
          the biggest gaps surface first. Field labels are human-readable
          ("Highlight video" not "highlight_video_url"). */}
      {missing.length > 0 ? (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Most-missing fields
          </p>
          <ul className="space-y-2">
            {missing.slice(0, 5).map((field) => (
              <li
                key={field.field_name}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  {field.null_pct >= 50 && (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  {field.field_name}
                </span>
                <span className="text-gray-500 font-mono text-xs">
                  {field.null_count} / {field.total_role_users}{' '}
                  <span className={field.null_pct >= 50 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>
                    ({field.null_pct}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-gray-400">All required fields filled — nothing to flag.</p>
      )}
    </div>
  )
}
