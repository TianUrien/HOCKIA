/**
 * AdminAIOpinions Page
 *
 * Source-of-truth dashboard for Section F AI Opinion Engine:
 *   - Behavioral metrics (volume, prompt_version split, model split)
 *   - Qualitative signal (recruiter feedback with reason text)
 *
 * Complements GA4 — GA captures the behavioral funnel without PII,
 * this page surfaces the verdict text + reason text that GA never
 * sees. Pairs with the postgres triggers from Phase 2 Slice B2 so
 * stale rows are excluded naturally.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Sparkles,
  RefreshCw,
  Users,
  MessagesSquare,
  ThumbsUp,
  ThumbsDown,
  Clock,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { StatCard } from '../components/StatCard'
import {
  getAIOpinionMetrics,
  getRecentAIOpinionFeedback,
} from '../api/adminApi'
import type {
  AIOpinionMetrics,
  AIOpinionFeedbackPage,
  AIOpinionFeedbackRow,
} from '../api/adminApi'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'
import { getRoleBadgeClasses } from '@/lib/roleColors'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

type DaysFilter = 7 | 30 | 90
type RatingFilter = 'all' | 'up' | 'down'

const PAGE_SIZE = 25

export function AdminAIOpinions() {
  const [metrics, setMetrics] = useState<AIOpinionMetrics | null>(null)
  const [feedbackPage, setFeedbackPage] = useState<AIOpinionFeedbackPage | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all')
  const [offset, setOffset] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setIsLoadingMetrics(true)
    try {
      const data = await getAIOpinionMetrics(daysFilter)
      setMetrics(data)
    } catch (err) {
      logger.error('[AdminAIOpinions] metrics fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setIsLoadingMetrics(false)
    }
  }, [daysFilter])

  const fetchFeedback = useCallback(async () => {
    setIsLoadingFeedback(true)
    try {
      const data = await getRecentAIOpinionFeedback({
        limit: PAGE_SIZE,
        offset,
        rating: ratingFilter === 'all' ? null : ratingFilter,
      })
      setFeedbackPage(data)
    } catch (err) {
      logger.error('[AdminAIOpinions] feedback fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load feedback')
    } finally {
      setIsLoadingFeedback(false)
    }
  }, [offset, ratingFilter])

  useEffect(() => {
    document.title = 'AI Opinions | HOCKIA Admin'
  }, [])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  useEffect(() => {
    fetchFeedback()
  }, [fetchFeedback])

  // Reset to first page when the rating filter changes — otherwise a
  // user paginating through "down only" and switching to "all" stays
  // on a deep offset that may have nothing useful at the top.
  useEffect(() => {
    setOffset(0)
  }, [ratingFilter])

  const refresh = () => {
    fetchMetrics()
    fetchFeedback()
  }

  const feedbackRate =
    metrics && metrics.summary.total_fresh_generations > 0
      ? Math.round(
          (metrics.feedback.total_rated / metrics.summary.total_fresh_generations) * 100,
        )
      : 0

  const downWithReasonRate =
    metrics && metrics.feedback.down_count > 0
      ? Math.round(
          (metrics.feedback.down_with_reason / metrics.feedback.down_count) * 100,
        )
      : 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            AI Opinion Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Section F — verdict generations + recruiter feedback. Quantitative
            funnel data is also in GA4 under <code>ai_opinion_*</code> events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value) as DaysFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoadingMetrics || isLoadingFeedback}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Fresh generations"
          value={metrics?.summary.total_fresh_generations ?? 0}
          icon={Sparkles}
          color="purple"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Unique recruiters"
          value={metrics?.summary.unique_recruiters ?? 0}
          icon={Users}
          color="blue"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Players evaluated"
          value={metrics?.summary.unique_players_evaluated ?? 0}
          icon={Users}
          color="green"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Still cached"
          value={metrics?.summary.still_fresh_count ?? 0}
          icon={Clock}
          color="amber"
          loading={isLoadingMetrics}
        />
      </div>

      {/* Feedback summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total ratings"
          value={metrics?.feedback.total_rated ?? 0}
          icon={MessagesSquare}
          color="purple"
          trend={
            metrics
              ? {
                  value: `${feedbackRate}%`,
                  label: 'of generations rated',
                  direction: 'neutral',
                }
              : undefined
          }
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Thumbs up"
          value={metrics?.feedback.up_count ?? 0}
          icon={ThumbsUp}
          color="green"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Thumbs down"
          value={metrics?.feedback.down_count ?? 0}
          icon={ThumbsDown}
          color="rose"
          loading={isLoadingMetrics}
        />
        <StatCard
          label="Down votes w/ reason"
          value={metrics?.feedback.down_with_reason ?? 0}
          icon={MessagesSquare}
          color="amber"
          trend={
            metrics && metrics.feedback.down_count > 0
              ? {
                  value: `${downWithReasonRate}%`,
                  label: 'of downs explained',
                  direction: 'neutral',
                }
              : undefined
          }
          loading={isLoadingMetrics}
        />
      </div>

      {/* Daily trend */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Daily fresh generations
        </h2>
        {isLoadingMetrics ? (
          <div className="h-64 bg-gray-50 rounded animate-pulse" />
        ) : !metrics || metrics.daily.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-gray-500">
            No data in this window.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.daily} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }}
                  labelStyle={{ color: '#374151' }}
                />
                <Line
                  type="monotone"
                  dataKey="generations"
                  stroke={HOCKIA_PRIMARY}
                  strokeWidth={2}
                  dot={{ fill: HOCKIA_PRIMARY, r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-version splits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Generations by prompt version
          </h2>
          {isLoadingMetrics ? (
            <div className="h-56 bg-gray-50 rounded animate-pulse" />
          ) : !metrics || metrics.by_version.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-gray-500">
              No data in this window.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.by_version} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="prompt_version" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }} />
                  <Bar dataKey="generations" fill={HOCKIA_PRIMARY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Feedback by prompt version
          </h2>
          {isLoadingMetrics ? (
            <div className="h-56 bg-gray-50 rounded animate-pulse" />
          ) : !metrics || metrics.feedback.by_version.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-gray-500">
              No feedback recorded in this window.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.feedback.by_version} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="prompt_version" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="up_count" name="👍" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="down_count" name="👎" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Top recruiters */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Top recruiters by generations
        </h2>
        {isLoadingMetrics ? (
          <div className="h-32 bg-gray-50 rounded animate-pulse" />
        ) : !metrics || metrics.top_recruiters.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            No recruiters generated opinions in this window.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {metrics.top_recruiters.map((r) => (
              <li key={r.viewer_id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-gray-900 truncate">
                    {r.viewer_name ?? r.viewer_id.slice(0, 8)}
                  </span>
                  {r.viewer_role && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClasses(r.viewer_role)}`}>
                      {r.viewer_role}
                    </span>
                  )}
                </div>
                <span className="text-gray-600 font-mono text-xs">
                  {r.generations.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Feedback table */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">
              Recent feedback
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Recruiter ratings + reasons. Click a row to see the full verdict + citations.
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs">
            {(['all', 'down', 'up'] as RatingFilter[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatingFilter(r)}
                className={[
                  'px-2.5 py-1 rounded-md font-medium transition',
                  ratingFilter === r
                    ? 'bg-purple-100 text-purple-700'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {r === 'all' ? 'All' : r === 'down' ? '👎 Down' : '👍 Up'}
              </button>
            ))}
          </div>
        </div>

        {isLoadingFeedback ? (
          <div className="p-6 space-y-2">
            <div className="h-12 bg-gray-50 rounded animate-pulse" />
            <div className="h-12 bg-gray-50 rounded animate-pulse" />
            <div className="h-12 bg-gray-50 rounded animate-pulse" />
          </div>
        ) : !feedbackPage || feedbackPage.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">
            No feedback matches this filter.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {feedbackPage.rows.map((row) => (
                <FeedbackRow
                  key={row.feedback_id}
                  row={row}
                  expanded={expandedRow === row.feedback_id}
                  onToggle={() =>
                    setExpandedRow(expandedRow === row.feedback_id ? null : row.feedback_id)
                  }
                />
              ))}
            </ul>

            {/* Pagination */}
            <div className="p-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span>
                {offset + 1}–{Math.min(offset + feedbackPage.rows.length, feedbackPage.total)} of{' '}
                {feedbackPage.total.toLocaleString()}
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
                  disabled={offset + feedbackPage.rows.length >= feedbackPage.total}
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

function FeedbackRow({
  row,
  expanded,
  onToggle,
}: {
  row: AIOpinionFeedbackRow
  expanded: boolean
  onToggle: () => void
}) {
  const isDown = row.rating === 'down'
  return (
    <li
      className="px-5 py-3 hover:bg-gray-50 cursor-pointer"
      onClick={onToggle}
      data-testid="admin-feedback-row"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {isDown ? (
            <ThumbsDown className="w-4 h-4 text-rose-500" />
          ) : (
            <ThumbsUp className="w-4 h-4 text-green-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
            <span className="font-medium text-gray-700">
              {row.viewer_name ?? row.viewer_id.slice(0, 8)}
            </span>
            <span>→</span>
            <span className="font-medium text-gray-700">
              {row.player_name ?? row.player_id.slice(0, 8)}
            </span>
            <span>·</span>
            <span>{formatAdminDate(row.feedback_created_at)}</span>
            <span>·</span>
            <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">
              {row.prompt_version}
            </code>
          </div>
          {row.reason && (
            <p className="text-sm text-gray-800 italic">"{row.reason}"</p>
          )}
          {!row.reason && (
            <p className="text-xs text-gray-400">No reason provided</p>
          )}
          {expanded && (
            <div className="mt-3 p-3 bg-gray-50 rounded-md text-xs space-y-2">
              <div>
                <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px]">
                  Verdict
                </span>
                <p className="text-gray-800 mt-0.5">{row.verdict_short}</p>
              </div>
              {row.citations.length > 0 && (
                <div>
                  <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px]">
                    Citations
                  </span>
                  <ul className="mt-0.5 space-y-1">
                    {row.citations.map((c, i) => (
                      <li key={`${c.field}-${i}`} className="text-gray-700">
                        <code className="text-purple-700 mr-1">{c.field}</code>
                        — {c.claim}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-3 text-[10px] text-gray-500 pt-1 border-t border-gray-200">
                <span>Model: {row.model}</span>
                <span>Opinion created: {formatAdminDate(row.opinion_created_at)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export default AdminAIOpinions
