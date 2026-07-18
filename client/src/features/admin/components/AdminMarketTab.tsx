/**
 * AdminMarketTab — the market-intelligence layer of Admin → Opportunities.
 *
 * Decisions at the top, evidence below: the Next-best-actions panel (rules
 * engine over the aggregates) opens the tab; the health strip, balance
 * matrix, funnels, club table, and country splits are the drill-down.
 *
 * Small-N honesty by design: absolute counts and medians, tables and tiles
 * over charts, single-hue direct-labeled funnel bars (no legend needed for
 * one series), and gap cells flagged with a text chip — never color alone.
 * The Operations tab remains the per-vacancy drill-down; nothing here
 * duplicates it.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Lightbulb,
  RefreshCw,
  Loader2,
  Users,
  Building2,
  Briefcase,
  Clock,
  Snowflake,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react'
import { StatCard } from './StatCard'
import { getMarketIntelligence } from '../api/adminApi'
import { evaluateMarketRules, type MarketRecommendation } from '../lib/marketRules'
import type { MarketIntelligence, MarketMatrixCell, MarketGender } from '../types'

const OWNER_BADGE: Record<MarketRecommendation['owner'], string> = {
  Acquisition: 'bg-purple-100 text-purple-700',
  Ops: 'bg-amber-100 text-amber-700',
  Product: 'bg-blue-100 text-blue-700',
  Growth: 'bg-green-100 text-green-700',
}

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
const POSITION_LABEL: Record<string, string> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  midfielder: 'Midfielder',
  forward: 'Forward',
}

/** The same gap predicate the rules engine uses — the chip and the
 *  recommendation must never disagree. */
const isGapCell = (c: MarketMatrixCell) =>
  c.demand_window >= 2 && c.apps_window < c.demand_window && c.supply_active < c.demand_window * 2

function FunnelBars({ title, stages }: {
  title: string
  stages: { label: string; value: number }[]
}) {
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].value : null
          const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null
          return (
            <div key={s.label} className="flex items-center gap-3">
              <span className="w-36 text-xs text-gray-600 flex-shrink-0">{s.label}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full bg-purple-600 rounded"
                  style={{ width: `${(s.value / max) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-medium text-gray-900 tabular-nums">
                {s.value}
              </span>
              <span className="w-12 text-right text-xs text-gray-400 tabular-nums">
                {conv !== null ? `${conv}%` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Fixed series order + hues for the trends chart (categorical palette,
 *  validated: CVD ΔE ≥ 16 all adjacent pairs on the light surface; the amber
 *  contrast WARN is discharged by direct value labels + the sr-only table). */
const TREND_SERIES = [
  { key: 'posted', label: 'Vacancies posted', color: '#9333ea' },
  { key: 'applications', label: 'Applications', color: '#0d9488' },
  { key: 'filled', label: 'Filled via HOCKIA', color: '#f59e0b' },
] as const

function TrendsChart({ trends }: { trends: MarketIntelligence['trends'] }) {
  const max = Math.max(1, ...trends.flatMap((t) => [t.posted, t.applications, t.filled]))
  const allZero = trends.every((t) => t.posted === 0 && t.applications === 0 && t.filled === 0)
  const monthLabel = (m: string) =>
    new Date(m + '-01T00:00:00Z').toLocaleString('en', { month: 'short', timeZone: 'UTC' })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Last 6 months</h3>
        <div className="flex items-center gap-3">
          {TREND_SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-xs text-gray-600">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {allZero ? (
        <p className="text-sm text-gray-500 py-6 text-center">No marketplace activity in the last 6 months</p>
      ) : (
        <div className="flex items-end justify-between gap-4 h-36 pt-4">
          {trends.map((t) => (
            <div key={t.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="flex items-end gap-0.5 h-28">
                {TREND_SERIES.map((s) => {
                  const v = t[s.key]
                  return (
                    <div key={s.key} className="relative group flex flex-col items-center justify-end h-full">
                      {v > 0 && (
                        <span className="text-[10px] text-gray-600 tabular-nums leading-none mb-0.5">{v}</span>
                      )}
                      <div
                        className="w-3.5 rounded-t"
                        style={{ height: `${Math.max(v > 0 ? 4 : 1, (v / max) * 96)}px`, backgroundColor: v > 0 ? s.color : '#e5e7eb' }}
                      />
                      <span className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] text-white z-10">
                        {monthLabel(t.month)} · {s.label}: {v}
                      </span>
                    </div>
                  )
                })}
              </div>
              <span className="text-xs text-gray-500">{monthLabel(t.month)}</span>
            </div>
          ))}
        </div>
      )}
      {/* Accessible table equivalent of the chart. */}
      <table className="sr-only">
        <caption>Marketplace activity by month</caption>
        <thead><tr><th>Month</th><th>Posted</th><th>Applications</th><th>Filled</th></tr></thead>
        <tbody>
          {trends.map((t) => (
            <tr key={t.month}><td>{t.month}</td><td>{t.posted}</td><td>{t.applications}</td><td>{t.filled}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const QUALITY_ATTR_LABEL: Record<string, string> = {
  compensation: 'compensation',
  housing: 'housing',
  flights: 'flights',
  description: 'longer description',
  start_date: 'start date',
  level: 'level sought',
  club_logo: 'club logo',
  deadline: 'deadline',
}

const scoreChipClass = (score: number) =>
  score >= 75 ? 'bg-green-100 text-green-700'
  : score >= 50 ? 'bg-amber-100 text-amber-700'
  : 'bg-red-100 text-red-700'

export function AdminMarketTab() {
  const [data, setData] = useState<MarketIntelligence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getMarketIntelligence(90))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market intelligence')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="px-4 py-6 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
        {error ?? 'No data'}
        <button onClick={() => void fetchData()} className="ml-3 underline">Retry</button>
      </div>
    )
  }

  const recommendations = evaluateMarketRules(data)
  const h = data.health
  const responseRate = h.total_apps > 0 ? Math.round((h.responded_apps / h.total_apps) * 100) : null
  const cellFor = (position: string, gender: MarketGender) =>
    data.matrix.find((c) => c.position === position && c.gender === gender)

  return (
    <div className="space-y-6">
      {/* ── Next best actions ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            Next best actions
          </h2>
          <button
            onClick={() => void fetchData()}
            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="Refresh"
            aria-label="Refresh market data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {recommendations.length === 0 ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            No rules firing right now — the marketplace has no urgent gaps by current thresholds.
          </p>
        ) : (
          <ol className="space-y-3">
            {recommendations.map((r, i) => (
              <li key={r.id} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {r.title}
                    <span className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium align-middle ${OWNER_BADGE[r.owner]}`}>
                      {r.owner}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{r.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Health strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Open demand" value={h.open_vacancies} icon={Briefcase} color="purple" />
        <StatCard
          label="Active supply"
          value={h.active_supply}
          icon={Users}
          color="green"
          trend={h.stale_supply > 0 ? { value: h.stale_supply, label: 'stale', direction: 'neutral' } : undefined}
        />
        <StatCard label="Median apps/vacancy" value={h.median_apps_per_vacancy ?? '—'} icon={Users} color="blue" />
        <StatCard label="Cold vacancies" value={h.cold_vacancies} icon={Snowflake} color="amber" />
        <StatCard
          label="Response rate"
          value={responseRate !== null ? `${responseRate}%` : '—'}
          icon={MessageSquare}
          color={responseRate !== null && responseRate < 50 ? 'red' : 'green'}
        />
        <StatCard label="Filled via HOCKIA" value={h.filled_via_hockia} icon={CheckCircle2} color="green" />
        <StatCard
          label="First app (median)"
          value={h.median_hours_to_first_app !== null ? `${Math.round(h.median_hours_to_first_app)}h` : '—'}
          icon={Clock}
          color="blue"
        />
        <StatCard
          label="Time to fill (median)"
          value={h.median_days_to_fill !== null ? `${Math.round(h.median_days_to_fill)}d` : '—'}
          icon={Clock}
          color="purple"
        />
      </div>

      {/* ── Balance matrix ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900">Market balance — demand vs supply</h3>
        <p className="text-xs text-gray-500 mb-3">
          Per cell: vacancies (last {data.meta.demand_window_days}d) · active open-to-play players · applications.
          Chips mark segments where demand outruns supply.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Position</th>
                {(['Men', 'Women'] as MarketGender[]).map((g) => (
                  <th key={g} className="py-2 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{g}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {POSITIONS.map((pos) => (
                <tr key={pos}>
                  <td className="py-2.5 pr-4 font-medium text-gray-900">{POSITION_LABEL[pos]}</td>
                  {(['Men', 'Women'] as MarketGender[]).map((g) => {
                    const c = cellFor(pos, g)
                    if (!c) return <td key={g} className="py-2.5 px-4 text-gray-400">—</td>
                    const gap = isGapCell(c)
                    return (
                      <td key={g} className={`py-2.5 px-4 ${gap ? 'bg-red-50/70' : ''}`}>
                        <span className="tabular-nums text-gray-900">{c.demand_window}</span>
                        <span className="text-gray-400"> vac · </span>
                        <span className="tabular-nums text-gray-900">{c.supply_active}</span>
                        <span className="text-gray-400"> plyr · </span>
                        <span className="tabular-nums text-gray-900">{c.apps_window}</span>
                        <span className="text-gray-400"> app</span>
                        {gap && (
                          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium">
                            gap
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data.coach_demand.open_now > 0 || data.coach_demand.demand_window > 0) && (
          <p className="text-xs text-gray-500 mt-3">
            Coach openings (not in the player matrix): {data.coach_demand.open_now} open now,{' '}
            {data.coach_demand.demand_window} in the last {data.meta.demand_window_days}d.
          </p>
        )}
      </div>

      {/* ── Funnels ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelBars
          title="Vacancy funnel (all published vacancies)"
          stages={[
            { label: 'Published', value: data.vacancy_funnel.published },
            { label: 'Viewed ≥1×', value: data.vacancy_funnel.viewed },
            { label: 'Got ≥1 application', value: data.vacancy_funnel.applied },
            { label: 'Club responded', value: data.vacancy_funnel.responded },
            { label: 'Filled via HOCKIA', value: data.vacancy_funnel.filled },
          ]}
        />
        <FunnelBars
          title="Player funnel (all player accounts)"
          stages={[
            { label: 'Players', value: data.player_funnel.players },
            { label: 'Completed profile', value: data.player_funnel.completed_profile },
            { label: 'Open to play', value: data.player_funnel.open_to_play },
            { label: 'Viewed a vacancy', value: data.player_funnel.viewed_vacancy },
            { label: 'Applied', value: data.player_funnel.applied },
            { label: 'Got a response', value: data.player_funnel.got_response },
            { label: 'Shortlisted+', value: data.player_funnel.advanced },
          ]}
        />
      </div>

      {/* ── Club behavior ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            Club behavior
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">
            Every posting club. Amber rows have applications waiting on a reply.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-y border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Club</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Posted</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Open</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Apps</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Responded</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Pending</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Median response</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Filled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.clubs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">No posting clubs yet</td></tr>
              ) : data.clubs.map((c) => (
                <tr key={c.club_profile_id} className={c.pending_backlog > 0 ? 'bg-amber-50/60' : undefined}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{c.club_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.posted}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.open_now}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.apps_received}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.responded}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.pending_backlog}
                    {c.pending_backlog > 0 && c.oldest_pending_days !== null && (
                      <span className="text-xs text-amber-700"> (oldest {c.oldest_pending_days}d)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.median_response_days !== null ? `${Math.round(c.median_response_days)}d` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.filled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Country splits ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Demand by country</h3>
          {data.demand_by_country.length === 0 ? (
            <p className="text-sm text-gray-500">No located vacancies</p>
          ) : (
            <ul className="space-y-1.5">
              {data.demand_by_country.map((d) => (
                <li key={d.country} className="flex justify-between text-sm">
                  <span className="text-gray-700">{d.country}</span>
                  <span className="tabular-nums text-gray-900">
                    {d.vacancies}
                    <span className="text-xs text-gray-400"> ({d.open_now} open)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Supply by player location</h3>
          <p className="text-xs text-gray-400 mb-2">Free-text locations, as entered by players</p>
          {data.supply_by_country.length === 0 ? (
            <p className="text-sm text-gray-500">No located open-to-play players</p>
          ) : (
            <ul className="space-y-1.5">
              {data.supply_by_country.map((s) => (
                <li key={s.country} className="flex justify-between text-sm">
                  <span className="text-gray-700">{s.country}</span>
                  <span className="tabular-nums text-gray-900">
                    {s.players}
                    <span className="text-xs text-gray-400"> ({s.active} active)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Trends (Phase 2) ──────────────────────────────────────────── */}
      <TrendsChart trends={data.trends} />

      {/* ── Performance: top vacancies + posting quality (Phase 2) ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Top vacancies by applications</h3>
          {data.top_vacancies.length === 0 ? (
            <p className="text-sm text-gray-500">No vacancies with applications yet</p>
          ) : (
            <ul className="space-y-2">
              {data.top_vacancies.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-900 truncate">{v.title}</p>
                    <p className="text-xs text-gray-500 truncate">{v.club_name}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      v.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>{v.status}</span>
                    <span className="tabular-nums font-medium text-gray-900">{v.applications}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Open-vacancy posting quality</h3>
          <p className="text-xs text-gray-400 mb-2">
            8-point best-practice checklist — not correlation-derived at current volume
          </p>
          {data.open_vacancy_quality.length === 0 ? (
            <p className="text-sm text-gray-500">No open vacancies</p>
          ) : (
            <ul className="space-y-2">
              {data.open_vacancy_quality.map((q) => {
                const isCold = q.days_open > 14 && q.app_count === 0
                return (
                  <li key={q.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {/* flex (not inline-flex) + min-w-0 so a long title
                            truncates INSIDE the card and the cold badge stays
                            visible instead of clipping at the edge. */}
                        <p className="flex items-center gap-1.5 min-w-0 text-gray-900">
                          <span className="truncate min-w-0">{q.title}</span>
                          {isCold && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 flex-shrink-0 whitespace-nowrap">
                              cold · {q.days_open}d · 0 apps
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{q.club_name}</p>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums flex-shrink-0 ${scoreChipClass(q.score)}`}>
                        {q.score}
                      </span>
                    </div>
                    {q.missing.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                        missing: {q.missing.map((m) => QUALITY_ATTR_LABEL[m] ?? m).join(', ')}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Corridors + player behavior (Phase 2) ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Recruitment corridors</h3>
          <p className="text-xs text-gray-400 mb-2">Applicant nationality → vacancy country</p>
          {data.corridors.flows.length === 0 ? (
            <p className="text-sm text-gray-500">No cross-referenced applications yet</p>
          ) : (
            <ul className="space-y-1.5">
              {data.corridors.flows.map((f) => (
                <li key={`${f.from_country}:${f.to_country}`} className="flex justify-between text-sm">
                  <span className="text-gray-700">{f.from_country} → {f.to_country}</span>
                  <span className="tabular-nums font-medium text-gray-900">{f.applications}</span>
                </li>
              ))}
            </ul>
          )}
          {data.corridors.unknown_origin > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              +{data.corridors.unknown_origin} application{data.corridors.unknown_origin === 1 ? '' : 's'} from
              players without a structured nationality
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Player behavior</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mb-3">
            <span className="text-gray-600">Applicants (all-time)</span>
            <span className="tabular-nums text-gray-900 text-right">{data.player_behavior.applicants}</span>
            <span className="text-gray-600">Median apps / applicant</span>
            <span className="tabular-nums text-gray-900 text-right">{data.player_behavior.median_apps_per_applicant ?? '—'}</span>
            <span className="text-gray-600">Applied to 2+ vacancies</span>
            <span className="tabular-nums text-gray-900 text-right">{data.player_behavior.multi_appliers}</span>
            <span className="text-gray-600">Median signup → first application</span>
            <span className="tabular-nums text-gray-900 text-right">
              {data.player_behavior.median_days_signup_to_first_app != null
                ? `${Math.round(data.player_behavior.median_days_signup_to_first_app)}d` : '—'}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Silent supply · {data.player_behavior.silent_supply.count}
              </p>
              <p className="text-xs text-gray-400">Active open-to-play, never applied — activation targets</p>
              {data.player_behavior.silent_supply.players.length > 0 && (
                <p className="text-xs text-gray-600 mt-0.5 truncate">
                  {data.player_behavior.silent_supply.players.map((p) => p.name ?? '—').join(', ')}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Burned · {data.player_behavior.burned.count}
              </p>
              <p className="text-xs text-gray-400">Applied 7+ days ago, never got any response — churn risk</p>
              {data.player_behavior.burned.players.length > 0 && (
                <ul className="text-xs text-gray-600 mt-0.5 space-y-0.5">
                  {data.player_behavior.burned.players.map((p) => (
                    <li key={p.id} className="truncate">
                      {p.name ?? '—'} · {p.applications} app{p.applications === 1 ? '' : 's'} · last {p.days_since_last_app}d ago
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Computed {new Date(data.meta.computed_at + 'Z').toLocaleString()} · demand window{' '}
        {data.meta.demand_window_days}d · test accounts excluded · medians, not means — counts are
        small while the marketplace grows, so absolute numbers are shown throughout.
      </p>
    </div>
  )
}