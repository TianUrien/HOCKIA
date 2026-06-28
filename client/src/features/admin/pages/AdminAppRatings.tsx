/**
 * AdminAppRatings — dashboard for the internal app rating prompt (Slice 2).
 * Mirrors AdminFeedback: headline StatCards + distribution/trend charts +
 * role/platform/country/version breakdowns + a filterable paginated ratings list.
 * Data comes from two SECURITY DEFINER RPCs (admin_get_app_ratings_metrics/list).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Star, RefreshCw, Eye, TrendingUp, XCircle, Users, MessageSquare,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { StatCard } from '../components/StatCard'
import { getAppRatingsMetrics, getAppRatingsList } from '../api/adminApi'
import type { AppRatingsMetrics, AppRatingsListPage, AppRatingRow } from '../api/adminApi'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'
import { getRoleBadgeClasses } from '@/lib/roleColors'

type DaysFilter = 7 | 30 | 90
const PAGE_SIZE = 25

function starBadgeClass(rating: number): string {
  if (rating >= 4) return 'bg-emerald-100 text-emerald-700'
  if (rating === 3) return 'bg-amber-100 text-amber-700'
  return 'bg-rose-100 text-rose-700'
}

function avgClass(avg: number | null): string {
  if (avg == null) return 'text-gray-400'
  if (avg >= 4) return 'text-emerald-600'
  if (avg >= 3) return 'text-amber-600'
  return 'text-rose-600'
}

function shortDay(d: string): string {
  return d.slice(5, 10) // MM-DD
}

export function AdminAppRatings() {
  const [metrics, setMetrics] = useState<AppRatingsMetrics | null>(null)
  const [page, setPage] = useState<AppRatingsListPage | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [starsFilter, setStarsFilter] = useState<number | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setIsLoadingMetrics(true)
    try {
      setMetrics(await getAppRatingsMetrics(daysFilter))
    } catch (err) {
      logger.error('[AdminAppRatings] metrics fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setIsLoadingMetrics(false)
    }
  }, [daysFilter])

  const fetchList = useCallback(async () => {
    setIsLoadingList(true)
    try {
      setPage(await getAppRatingsList({ limit: PAGE_SIZE, offset, stars: starsFilter, platform: platformFilter, role: roleFilter }))
    } catch (err) {
      logger.error('[AdminAppRatings] list fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load ratings')
    } finally {
      setIsLoadingList(false)
    }
  }, [offset, starsFilter, platformFilter, roleFilter])

  useEffect(() => { document.title = 'App Ratings | HOCKIA Admin' }, [])
  useEffect(() => { fetchMetrics() }, [fetchMetrics])
  useEffect(() => { fetchList() }, [fetchList])
  useEffect(() => { setOffset(0) }, [starsFilter, platformFilter, roleFilter])

  const refresh = () => { fetchMetrics(); fetchList() }

  const s = metrics?.summary
  const avgText = s?.avg_rating != null ? s.avg_rating.toFixed(1) : '—'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-500" />
            App Ratings
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Internal 1–5 star prompt for engaged users (onboarded + 7 active days). No App Store routing.
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
          <button type="button" onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="Avg rating" value={avgText} icon={Star} color="amber" loading={isLoadingMetrics} />
        <StatCard label="Ratings" value={s?.total_ratings ?? 0} icon={MessageSquare} color="purple" loading={isLoadingMetrics} />
        <StatCard label="Prompts shown" value={s?.prompts_shown ?? 0} icon={Eye} color="blue" loading={isLoadingMetrics} />
        <StatCard label="Conversion" value={`${s?.conversion_rate ?? 0}%`} icon={TrendingUp} color="green" loading={isLoadingMetrics} />
        <StatCard label="Dismissal" value={`${s?.dismissal_rate ?? 0}%`} icon={XCircle} color="rose" loading={isLoadingMetrics} />
        <StatCard label="Eligible, not asked" value={metrics?.eligible_not_prompted ?? 0} icon={Users} color="gray" loading={isLoadingMetrics} />
      </div>

      {/* Distribution + trend */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Rating distribution</h2>
          {isLoadingMetrics ? (
            <div className="h-56 bg-gray-50 rounded animate-pulse" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics?.distribution ?? []} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="rating" tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(r) => `${r}★`} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }} />
                  <Bar dataKey="count" fill="#8026FA" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Daily prompt funnel</h2>
          {isLoadingMetrics ? (
            <div className="h-56 bg-gray-50 rounded animate-pulse" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics?.daily ?? []} margin={{ top: 5, right: 12, left: -8, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={shortDay} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line type="monotone" dataKey="shown" name="Shown" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="submitted" name="Rated" stroke="#10B981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="dismissed" name="Dismissed" stroke="#F43F5E" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BreakdownCard title="By role" rows={(metrics?.by_role ?? []).map((r) => ({ label: r.user_role, count: r.count, avg: r.avg }))} loading={isLoadingMetrics} />
        <BreakdownCard title="By platform" rows={(metrics?.by_platform ?? []).map((r) => ({ label: r.platform, count: r.count, avg: r.avg }))} loading={isLoadingMetrics} />
        <BreakdownCard title="By country" rows={(metrics?.by_country ?? []).map((r) => ({ label: r.country, count: r.count, avg: r.avg }))} loading={isLoadingMetrics} />
        <BreakdownCard title="By app version" rows={(metrics?.by_version ?? []).map((r) => ({ label: r.app_version, count: r.count, avg: r.avg }))} loading={isLoadingMetrics} />
      </div>

      {/* Ratings list */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-5 border-b border-gray-100 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Ratings</h2>
            <p className="text-xs text-gray-500 mt-0.5">Newest first. Click a row for the comment + full context.</p>
          </div>
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <span className="text-gray-500 mr-1">Stars:</span>
            {([null, 5, 4, 3, 2, 1] as (number | null)[]).map((st) => (
              <button
                key={st ?? 'all'}
                type="button"
                onClick={() => setStarsFilter(st)}
                className={[
                  'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium transition',
                  starsFilter === st ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {st == null ? 'All' : `${st}★`}
              </button>
            ))}
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-gray-500 mr-1">Platform:</span>
            {([null, 'web', 'pwa', 'ios-native', 'android-native'] as (string | null)[]).map((pf) => (
              <button
                key={pf ?? 'all'}
                type="button"
                onClick={() => setPlatformFilter(pf)}
                className={[
                  'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium transition',
                  platformFilter === pf ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {pf == null ? 'All' : pf}
              </button>
            ))}
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-gray-500 mr-1">Role:</span>
            {([null, 'player', 'coach', 'club', 'umpire', 'brand'] as (string | null)[]).map((rl) => (
              <button
                key={rl ?? 'all'}
                type="button"
                onClick={() => setRoleFilter(rl)}
                className={[
                  'px-2.5 min-h-[32px] inline-flex items-center rounded-md font-medium transition',
                  roleFilter === rl ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {rl == null ? 'All' : rl}
              </button>
            ))}
          </div>
        </div>

        {isLoadingList ? (
          <div className="p-6 space-y-2">
            <div className="h-14 bg-gray-50 rounded animate-pulse" />
            <div className="h-14 bg-gray-50 rounded animate-pulse" />
          </div>
        ) : !page || page.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">No ratings match this filter.</div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {page.rows.map((row) => (
                <RatingRowItem
                  key={row.id}
                  row={row}
                  expanded={expandedRow === row.id}
                  onToggle={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                />
              ))}
            </ul>
            <div className="p-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span>{offset + 1}–{Math.min(offset + page.rows.length, page.total)} of {page.total.toLocaleString()}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + page.rows.length >= page.total}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BreakdownCard({ title, rows, loading }: { title: string; rows: { label: string; count: number; avg: number }[]; loading: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      {loading ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">No data</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map((r) => (
            <li key={r.label} className="flex items-center justify-between text-xs">
              <span className="text-gray-700 truncate pr-2">{r.label}</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-gray-400">{r.count}</span>
                <span className={`font-semibold ${avgClass(r.avg)}`}>{r.avg?.toFixed(1)}★</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RatingRowItem({ row, expanded, onToggle }: { row: AppRatingRow; expanded: boolean; onToggle: () => void }) {
  return (
    <li className="px-5 py-3 hover:bg-gray-50" data-testid="admin-app-rating-row">
      <button type="button" onClick={onToggle} className="w-full flex items-start gap-3 text-left min-h-[44px]">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${starBadgeClass(row.rating_value)}`}>
          {row.rating_value}<Star className="w-3 h-3 fill-current" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5 flex-wrap">
            <span className="font-medium text-gray-700">{row.user_name ?? 'Unknown'}</span>
            {row.user_role && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getRoleBadgeClasses(row.user_role)}`}>
                {row.user_role}
              </span>
            )}
            {row.platform && <><span>·</span><span>{row.platform}</span></>}
            <span>·</span>
            <span>{formatAdminDate(row.submitted_at)}</span>
          </div>
          {row.feedback_text ? (
            <p className="text-sm text-gray-800 leading-snug">{expanded ? row.feedback_text : truncate(row.feedback_text, 160)}</p>
          ) : (
            <p className="text-xs italic text-gray-400">No comment</p>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 ml-9 p-3 bg-gray-50 rounded-md grid grid-cols-2 gap-3 text-[11px]">
          {row.country_name && <Detail label="Country" value={row.country_name} />}
          {row.app_version && <Detail label="App version" value={row.app_version} />}
          {row.build_number && <Detail label="Build" value={row.build_number} />}
          {row.environment && <Detail label="Environment" value={row.environment} />}
          {row.prompt_trigger_reason && <Detail label="Trigger" value={row.prompt_trigger_reason} />}
        </div>
      )}
    </li>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px] block mb-0.5">{label}</span>
      <span className="text-gray-700 break-all">{value}</span>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n).trimEnd() + '…'
}

export default AdminAppRatings
