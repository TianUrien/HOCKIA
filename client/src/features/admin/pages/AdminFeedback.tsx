/**
 * AdminFeedback Page
 *
 * Admin dashboard for the in-app user_feedback collection. Mirrors
 * the AdminAIOpinions layout from earlier this session: headline
 * StatCards + daily trend + filterable paginated list with click-
 * to-expand detail panels.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  MessageSquarePlus,
  RefreshCw,
  AlertTriangle,
  Bug,
  HelpCircle,
  Sparkles,
  Heart,
  MessageSquare,
  Users,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { StatCard } from '../components/StatCard'
import {
  getFeedbackMetrics,
  getFeedbackList,
  updateFeedback,
} from '../api/adminApi'
import type {
  FeedbackMetrics,
  FeedbackListPage,
  FeedbackRow,
  FeedbackStatusFilter,
  FeedbackCategoryFilter,
} from '../api/adminApi'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'
import { getRoleBadgeClasses } from '@/lib/roleColors'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

type DaysFilter = 7 | 30 | 90
type StatusFilter = 'all' | FeedbackStatusFilter
type CategoryFilter = 'all' | FeedbackCategoryFilter

const PAGE_SIZE = 25

const STATUS_LABEL: Record<FeedbackStatusFilter, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  planned: 'Planned',
  fixed: 'Fixed',
  closed: 'Closed',
}

const STATUS_BG: Record<FeedbackStatusFilter, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-amber-100 text-amber-700',
  planned: 'bg-purple-100 text-purple-700',
  fixed: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-200 text-gray-700',
}

const CATEGORY_META: Record<FeedbackCategoryFilter, { label: string; icon: typeof Bug; color: string }> = {
  bug:       { label: 'Bug',       icon: Bug,            color: 'text-rose-600' },
  confusing: { label: 'Confusing', icon: HelpCircle,     color: 'text-amber-600' },
  idea:      { label: 'Idea',      icon: Sparkles,       color: 'text-hockia-primary' },
  praise:    { label: 'Praise',    icon: Heart,          color: 'text-pink-500' },
  other:     { label: 'Other',     icon: MessageSquare,  color: 'text-gray-600' },
}

export function AdminFeedback() {
  const [metrics, setMetrics] = useState<FeedbackMetrics | null>(null)
  const [page, setPage] = useState<FeedbackListPage | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setIsLoadingMetrics(true)
    try {
      setMetrics(await getFeedbackMetrics(daysFilter))
    } catch (err) {
      logger.error('[AdminFeedback] metrics fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setIsLoadingMetrics(false)
    }
  }, [daysFilter])

  const fetchList = useCallback(async () => {
    setIsLoadingList(true)
    try {
      setPage(
        await getFeedbackList({
          limit: PAGE_SIZE,
          offset,
          status: statusFilter === 'all' ? null : statusFilter,
          category: categoryFilter === 'all' ? null : categoryFilter,
          urgentOnly,
        }),
      )
    } catch (err) {
      logger.error('[AdminFeedback] list fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load feedback')
    } finally {
      setIsLoadingList(false)
    }
  }, [offset, statusFilter, categoryFilter, urgentOnly])

  useEffect(() => {
    document.title = 'User Feedback | HOCKIA Admin'
  }, [])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // Reset offset when any filter changes — paging through "urgent
  // only" then flipping to "all" would otherwise leave you on a
  // deep offset.
  useEffect(() => {
    setOffset(0)
  }, [statusFilter, categoryFilter, urgentOnly])

  const refresh = () => {
    fetchMetrics()
    fetchList()
  }

  const handleStatusChange = async (id: string, newStatus: FeedbackStatusFilter) => {
    try {
      const updated = await updateFeedback({ id, status: newStatus })
      // Patch local state so the row visually updates without a full
      // re-fetch.
      setPage((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) => (r.id === id ? updated : r)),
            }
          : prev,
      )
      // Metrics will drift slightly until the next refresh; that's
      // acceptable for an admin surface.
    } catch (err) {
      logger.error('[AdminFeedback] status update failed', err)
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquarePlus className="w-6 h-6 text-purple-600" />
            User Feedback
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            In-app feedback from any signed-in user. 5/hour rate limit per user.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value) as DaysFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white min-h-[44px]"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoadingMetrics || isLoadingList}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-3 min-h-[44px] hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total"
          value={metrics?.summary.total ?? 0}
          icon={MessageSquarePlus}
          color="purple"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Urgent"
          value={metrics?.summary.urgent ?? 0}
          icon={AlertTriangle}
          color="red"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="New"
          value={metrics?.summary.new ?? 0}
          icon={MessageSquare}
          color="blue"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Open"
          value={metrics?.summary.open_total ?? 0}
          icon={MessageSquare}
          color="amber"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Unique users"
          value={metrics?.summary.unique_users ?? 0}
          icon={Users}
          color="green"
          loading={isLoadingMetrics}
        />
      </div>

      {/* Daily trend */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Daily submissions
        </h2>
        {isLoadingMetrics ? (
          <div className="h-64 bg-gray-50 rounded animate-pulse" />
        ) : !metrics || metrics.daily.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-gray-500">
            No feedback in this window.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.daily} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="submissions"
                  stroke={HOCKIA_PRIMARY}
                  strokeWidth={2}
                  dot={{ fill: HOCKIA_PRIMARY, r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Feedback list */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-5 border-b border-gray-100 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Feedback</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Urgent items float to the top. Click any row to see the full context.
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <span className="text-gray-500 mr-1">Status:</span>
            {(['all', 'new', 'reviewing', 'planned', 'fixed', 'closed'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={[
                  'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium transition',
                  statusFilter === s ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s as FeedbackStatusFilter]}
              </button>
            ))}
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-gray-500 mr-1">Category:</span>
            {(['all', 'bug', 'confusing', 'idea', 'praise', 'other'] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={[
                  'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium transition',
                  categoryFilter === c ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {c === 'all' ? 'All' : CATEGORY_META[c as FeedbackCategoryFilter].label}
              </button>
            ))}
            <span className="text-gray-300 mx-2">·</span>
            <label className="inline-flex items-center gap-1 cursor-pointer min-h-[32px] px-2">
              <input
                type="checkbox"
                checked={urgentOnly}
                onChange={(e) => setUrgentOnly(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span className="text-gray-600">Urgent only</span>
            </label>
          </div>
        </div>

        {isLoadingList ? (
          <div className="p-6 space-y-2">
            <div className="h-16 bg-gray-50 rounded animate-pulse" />
            <div className="h-16 bg-gray-50 rounded animate-pulse" />
          </div>
        ) : !page || page.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">
            No feedback matches this filter.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {page.rows.map((row) => (
                <FeedbackRowItem
                  key={row.id}
                  row={row}
                  expanded={expandedRow === row.id}
                  onToggle={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                  onStatusChange={(newStatus) => void handleStatusChange(row.id, newStatus)}
                />
              ))}
            </ul>

            <div className="p-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span>
                {offset + 1}–{Math.min(offset + page.rows.length, page.total)} of {page.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + page.rows.length >= page.total}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FeedbackRowItem({
  row,
  expanded,
  onToggle,
  onStatusChange,
}: {
  row: FeedbackRow
  expanded: boolean
  onToggle: () => void
  onStatusChange: (s: FeedbackStatusFilter) => void
}) {
  const meta = CATEGORY_META[row.category]
  const Icon = meta.icon
  return (
    <li className="px-5 py-3 hover:bg-gray-50" data-testid="admin-feedback-row">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 text-left min-h-[44px]"
      >
        <Icon className={`w-4 h-4 ${meta.color} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
            {row.is_urgent && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3" />
                Urgent
              </span>
            )}
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide text-[10px] ${STATUS_BG[row.status]}`}>
              {STATUS_LABEL[row.status]}
            </span>
            <span className="font-medium text-gray-700">{row.user_name ?? row.user_id.slice(0, 8)}</span>
            {row.user_role && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getRoleBadgeClasses(row.user_role)}`}>
                {row.user_role}
              </span>
            )}
            <span>·</span>
            <span>{formatAdminDate(row.created_at)}</span>
            {row.route && (
              <>
                <span>·</span>
                <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{row.route}</code>
              </>
            )}
          </div>
          <p className="text-sm text-gray-800 leading-snug whitespace-pre-wrap">
            {expanded ? row.body : truncate(row.body, 240)}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 ml-7 p-3 bg-gray-50 rounded-md text-xs space-y-3">
          <div>
            <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px]">
              Status
            </span>
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {(['new', 'reviewing', 'planned', 'fixed', 'closed'] as FeedbackStatusFilter[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatusChange(s)}
                  disabled={row.status === s}
                  className={[
                    'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium text-[11px]',
                    row.status === s
                      ? `${STATUS_BG[s]} cursor-default`
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50',
                  ].join(' ')}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {row.route_raw && row.route_raw !== row.route && (
            <div>
              <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px]">
                Raw route
              </span>
              <code className="block mt-1 text-[10px] text-gray-700 break-all">{row.route_raw}</code>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            {row.user_agent && (
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">
                  User agent
                </span>
                <span className="text-gray-700 break-all">{row.user_agent}</span>
              </div>
            )}
            {row.viewport && (
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">
                  Viewport
                </span>
                <span className="text-gray-700">{row.viewport}</span>
              </div>
            )}
            {row.environment && (
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">
                  Environment
                </span>
                <span className="text-gray-700">{row.environment}</span>
              </div>
            )}
            {row.app_version && (
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">
                  App version
                </span>
                <code className="text-gray-700">{row.app_version.slice(0, 8)}</code>
              </div>
            )}
            {row.resolved_at && (
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">
                  Resolved
                </span>
                <span className="text-gray-700">{formatAdminDate(row.resolved_at)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + '…'
}

export default AdminFeedback
