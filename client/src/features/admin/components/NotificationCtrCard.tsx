/**
 * NotificationCtrCard — Phase 3E
 *
 * Click-through rate per notification kind, last p_days days. Shown
 * on AdminOverview to answer "are users clicking the notifications
 * we send? which kinds work, which are noise?"
 */

import { useCallback, useEffect, useState } from 'react'
import { Bell, AlertTriangle, RefreshCw } from 'lucide-react'
import { getNotificationCtr, type NotificationCtrRow } from '../api/adminApi'
import { logger } from '@/lib/logger'

function humanKind(kind: string): string {
  // Notification kinds are snake_case (e.g. friend_request_received).
  // Title-case them for display.
  return kind
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function NotificationCtrCard({ days = 30 }: { days?: number }) {
  const [rows, setRows] = useState<NotificationCtrRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getNotificationCtr(days)
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => {
        logger.error('[NotificationCtrCard] fetch failed:', err)
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

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-6 bg-gray-100 rounded" />)}
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
            <h3 className="text-sm font-semibold text-gray-700">Notification CTR</h3>
            <p className="text-xs text-gray-500 mt-1 break-words">{error}</p>
            <button
              type="button"
              onClick={() => fetchData()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <Bell className="w-6 h-6 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">No notifications sent in the last {days} days.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-gray-700">Notification CTR (last {days}d)</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wider">
            <th className="text-left py-2 font-medium">Kind</th>
            <th className="text-right py-2 font-medium">Sent</th>
            <th className="text-right py-2 font-medium">Clicked</th>
            <th className="text-right py-2 font-medium">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className="border-b border-gray-100 last:border-0">
              <td className="py-2 text-gray-700 text-xs">{humanKind(r.kind)}</td>
              <td className="py-2 text-right text-gray-500 font-mono text-xs">{r.sent_count}</td>
              <td className="py-2 text-right text-gray-700 font-mono text-xs">{r.click_count}</td>
              <td className={`py-2 text-right font-semibold text-xs ${r.ctr_pct < 5 ? 'text-red-600' : r.ctr_pct < 20 ? 'text-amber-600' : 'text-green-600'}`}>
                {r.ctr_pct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
