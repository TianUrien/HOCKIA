/**
 * ConversationsTable — privacy-safe per-conversation analytics ("who messaged
 * whom"). Renders metadata ONLY (participants, roles, timing, reply, status,
 * source); the backing RPC never returns message content. Paginated + filterable
 * by status and source, server-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Check, Minus } from 'lucide-react'
import { getConversations } from '../api/analyticsApi'
import type { ConversationRow } from '../types'
import { formatAdminDateShort } from '../utils/formatDate'
import { getRoleColors } from '@/lib/roleColors'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  unanswered: 'bg-amber-100 text-amber-800',
  inactive: 'bg-gray-100 text-gray-600',
}

const ORIGIN_OPTIONS = ['Community', 'Profile', 'Opportunity', 'Hockia AI', 'Direct', 'unknown']

/** minutes → compact human duration, or em-dash when there was no reply. */
function formatReplyTime(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  return `${days.toFixed(1)}d`
}

function RoleBadge({ role }: { role: string }) {
  const colors = getRoleColors(role)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {role}
    </span>
  )
}

interface ConversationsTableProps {
  days: number
}

export function ConversationsTable({ days }: ConversationsTableProps) {
  const [rows, setRows] = useState<ConversationRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const [originFilter, setOriginFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Monotonic request id — only the latest in-flight fetch may write state, so
  // an out-of-order response (e.g. a superseded stale-offset fetch after a
  // filter change) can never overwrite the current page.
  const reqId = useRef(0)

  // Reset to the first page whenever the period or a filter changes so the
  // offset can't point past the (now smaller) result set.
  useEffect(() => {
    setPage(0)
  }, [days, statusFilter, originFilter])

  const fetchData = useCallback(async () => {
    const id = ++reqId.current
    setIsLoading(true)
    setError(null)
    try {
      const filters: Record<string, string> = {}
      if (statusFilter) filters.status = statusFilter
      if (originFilter) filters.origin = originFilter
      const { rows: r, total: t } = await getConversations(days, PAGE_SIZE, page * PAGE_SIZE, filters)
      if (id !== reqId.current) return // superseded by a newer request
      // Overshot the end (result set shrank under a stale offset): snap back to
      // page 0. Stay in the loading state — the page change triggers a refetch
      // that owns clearing it, so the count/empty state never flashes.
      if (r.length === 0 && page > 0) {
        setPage(0)
        return
      }
      setRows(r)
      setTotal(t)
      setIsLoading(false)
    } catch (err) {
      if (id !== reqId.current) return
      logger.error('[ConversationsTable] fetch failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
      setIsLoading(false)
    }
  }, [days, page, statusFilter, originFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE)

  const selectClass =
    'text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500'

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="unanswered">Unanswered</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          aria-label="Filter by source"
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All sources</option>
          {ORIGIN_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o === 'unknown' ? 'Unknown' : o}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500 ml-auto" role="status" aria-live="polite">
          {!isLoading && `${total.toLocaleString()} conversation${total === 1 ? '' : 's'}`}
        </span>
      </div>

      <div aria-busy={isLoading ? 'true' : 'false'}>
      {error ? (
        <p className="text-sm text-red-600 text-center py-8">{error}</p>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-11 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No conversations match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2.5 px-2 font-medium text-gray-500">From → To</th>
                <th className="text-left py-2.5 px-2 font-medium text-gray-500">First message</th>
                <th className="text-center py-2.5 px-2 font-medium text-gray-500">Reply?</th>
                <th className="text-right py-2.5 px-2 font-medium text-gray-500">Msgs</th>
                <th className="text-right py-2.5 px-2 font-medium text-gray-500">Time to reply</th>
                <th className="text-left py-2.5 px-2 font-medium text-gray-500">Status</th>
                <th className="text-left py-2.5 px-2 font-medium text-gray-500">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.conversation_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  {/* From → To (names + role badges) */}
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{c.sender_name ?? 'Unknown'}</span>
                      <RoleBadge role={c.sender_role} />
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                      <span className="font-medium text-gray-900">{c.recipient_name ?? 'Unknown'}</span>
                      <RoleBadge role={c.recipient_role} />
                    </div>
                  </td>
                  {/* First message */}
                  <td className="py-2.5 px-2 text-gray-600 whitespace-nowrap">
                    {formatAdminDateShort(c.first_message_at)}
                  </td>
                  {/* Reply? */}
                  <td className="py-2.5 px-2 text-center">
                    {c.replied ? (
                      <Check className="w-4 h-4 text-emerald-600 inline" aria-label="Replied" />
                    ) : (
                      <Minus className="w-4 h-4 text-gray-300 inline" aria-label="No reply" />
                    )}
                  </td>
                  {/* Msgs */}
                  <td className="py-2.5 px-2 text-right font-mono text-gray-900">
                    {Number(c.message_count).toLocaleString()}
                  </td>
                  {/* Time to reply */}
                  <td className="py-2.5 px-2 text-right font-mono text-gray-600 whitespace-nowrap">
                    {formatReplyTime(c.time_to_first_reply_minutes)}
                  </td>
                  {/* Status */}
                  <td className="py-2.5 px-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  {/* Source */}
                  <td className="py-2.5 px-2">
                    {c.origin === 'unknown' ? (
                      <span className="text-xs text-gray-400">Unknown</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                        {c.origin}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {/* Pagination */}
      {!isLoading && !error && total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">
            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>
            <span className="text-gray-500">
              Page {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
