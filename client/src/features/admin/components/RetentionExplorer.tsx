/**
 * RetentionExplorer — the detailed cohort view behind the Overview cards.
 *
 * Same service, same filters, same arithmetic: the summary strip at the top
 * calls admin_get_retention_summary and the grid calls
 * admin_get_retention_cohort_table with the identical filter object, so the
 * two can never tell different stories — and the CSV is built from the grid's
 * own payload rather than recomputed.
 *
 * Every cell shows the percentage AND the retained/eligible pair behind it. A
 * cohort whose window has not fully elapsed shows "—", never 0%.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import {
  getRetentionCohortTable,
  getRetentionFilterOptions,
  getRetentionSummary,
  DEFAULT_RETENTION_DAYS,
} from '../api/retentionApi'
import { buildRetentionCsv, retentionCsvFilename } from '../lib/retentionCsv'
import type {
  RetentionActivity,
  RetentionCohortTable,
  RetentionFilterOptions,
  RetentionFilters,
  RetentionGrain,
  RetentionMethod,
  RetentionSummary,
} from '../types/retention'
import { RETENTION_ACTIVITY_LABEL, RETENTION_METHOD_LABEL } from '../types/retention'
import { RetentionCard } from './RetentionSignals'
import { logger } from '@/lib/logger'

const PERIODS = [90, 180, 365] as const

/** Heat scale for the grid — deliberately gentle; the numbers carry the weight. */
function heatClass(pct: number | null): string {
  if (pct === null) return 'bg-gray-50 text-gray-400'
  if (pct >= 40) return 'bg-emerald-100 text-emerald-900'
  if (pct >= 25) return 'bg-emerald-50 text-emerald-800'
  if (pct >= 15) return 'bg-amber-50 text-amber-800'
  if (pct > 0) return 'bg-red-50 text-red-800'
  return 'bg-red-50 text-red-900'
}

function formatCohortStart(iso: string, grain: RetentionGrain): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return grain === 'month'
    ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : `w/c ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}`
}

export function RetentionExplorer() {
  const [method, setMethod] = useState<RetentionMethod>('bracket')
  const [activity, setActivity] = useState<RetentionActivity>('any')
  const [grain, setGrain] = useState<RetentionGrain>('week')
  // Defaults to the Overview's window so the cards there and the strip here
  // read identically until an admin deliberately widens the period.
  const [periodDays, setPeriodDays] = useState<number>(90)
  const [filters, setFilters] = useState<RetentionFilters>({})

  const [options, setOptions] = useState<RetentionFilterOptions | null>(null)
  const [table, setTable] = useState<RetentionCohortTable | null>(null)
  const [summary, setSummary] = useState<RetentionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRetentionFilterOptions()
      .then(setOptions)
      .catch((err) => logger.error('[RetentionExplorer] filter options failed', err))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Same window on both sides so the strip and the grid agree.
    const to = new Date()
    const from = new Date(to.getTime() - periodDays * 86_400_000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    try {
      const [cohorts, sum] = await Promise.all([
        getRetentionCohortTable({
          days: DEFAULT_RETENTION_DAYS,
          method,
          activity,
          grain,
          from: iso(from),
          to: iso(to),
          ...filters,
        }),
        getRetentionSummary({ days: DEFAULT_RETENTION_DAYS, method, activity, periodDays, ...filters }),
      ])
      setTable(cohorts)
      setSummary(sum)
    } catch (err) {
      logger.error('[RetentionExplorer] load failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load retention')
    } finally {
      setLoading(false)
    }
  }, [method, activity, grain, periodDays, filters])

  useEffect(() => {
    void load()
  }, [load])

  const days = table?.days ?? DEFAULT_RETENTION_DAYS

  const handleExport = useCallback(() => {
    if (!table) return
    const csv = buildRetentionCsv(table, filters)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = retentionCsvFilename(table)
    a.click()
    URL.revokeObjectURL(url)
  }, [table, filters])

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v !== null && v !== undefined && v !== '').length,
    [filters],
  )

  const setFilter = (key: keyof RetentionFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value === '' ? null : key === 'countryId' ? Number(value) : value,
    }))
  }

  const selectClass =
    'text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-200'

  return (
    <div className="space-y-4">
      {/* ── Controls ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Return method"
            className={selectClass}
            value={method}
            onChange={(e) => setMethod(e.target.value as RetentionMethod)}
          >
            {(Object.keys(RETENTION_METHOD_LABEL) as RetentionMethod[]).map((m) => (
              <option key={m} value={m}>{RETENTION_METHOD_LABEL[m]}</option>
            ))}
          </select>

          <select
            aria-label="Activity counted"
            className={selectClass}
            value={activity}
            onChange={(e) => setActivity(e.target.value as RetentionActivity)}
          >
            {(Object.keys(RETENTION_ACTIVITY_LABEL) as RetentionActivity[]).map((a) => (
              <option key={a} value={a}>{RETENTION_ACTIVITY_LABEL[a]}</option>
            ))}
          </select>

          <select
            aria-label="Cohort grain"
            className={selectClass}
            value={grain}
            onChange={(e) => setGrain(e.target.value as RetentionGrain)}
          >
            <option value="week">Weekly cohorts</option>
            <option value="month">Monthly cohorts</option>
          </select>

          <select
            aria-label="Registration period"
            className={selectClass}
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>Signups: last {p} days</option>
            ))}
          </select>

          <span className="w-px h-5 bg-gray-200 mx-1" />

          <select aria-label="Role" className={selectClass} value={filters.role ?? ''} onChange={(e) => setFilter('role', e.target.value)}>
            <option value="">All roles</option>
            {(options?.roles ?? []).map((r) => (
              <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}s</option>
            ))}
          </select>

          <select aria-label="Country" className={selectClass} value={filters.countryId ?? ''} onChange={(e) => setFilter('countryId', e.target.value)}>
            <option value="">All countries</option>
            {(options?.countries ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select aria-label="Platform" className={selectClass} value={filters.platform ?? ''} onChange={(e) => setFilter('platform', e.target.value)}>
            <option value="">All platforms</option>
            {(options?.platforms ?? []).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select aria-label="Acquisition source" className={selectClass} value={filters.source ?? ''} onChange={(e) => setFilter('source', e.target.value)}>
            <option value="">All sources</option>
            {(options?.sources ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button type="button" onClick={() => setFilters({})} className="text-xs font-medium text-gray-500 hover:text-gray-700 underline">
              Clear {activeFilterCount}
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!table || table.rows.length === 0}
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-40 rounded-lg px-3 py-1.5"
            >
              <Download className="w-3 h-3" /> Export CSV
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Cohort entry = account created. Eligible = the day-N window has fully elapsed (UTC).
          Percentages are always retained ÷ eligible; a blank cell means nobody is eligible yet — not 0%.
        </p>
      </div>

      {/* ── Summary strip: identical filters, identical numbers ────── */}
      {summary && summary.checkpoints.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {summary.checkpoints.map((c) => (
            <RetentionCard
              key={c.day}
              checkpoint={c}
              method={summary.method}
              activity={summary.activity}
              periodDays={summary.period_days}
            />
          ))}
        </div>
      )}

      {/* ── Cohort grid ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {error && (
          <div data-testid="explorer-error" className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-4">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {!error && loading && (
          <div data-testid="explorer-loading" className="p-6 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        )}

        {!error && !loading && table && table.rows.length === 0 && (
          <div data-testid="explorer-empty" className="p-8 text-center text-sm text-gray-500">
            No cohorts match these filters in the selected period.
          </div>
        )}

        {!error && !loading && table && table.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-2.5 font-semibold text-gray-700">Cohort</th>
                  <th className="px-4 py-2.5 font-semibold text-gray-700 text-right">Size</th>
                  {days.map((d) => (
                    <th key={d} className="px-4 py-2.5 font-semibold text-gray-700 text-center">D{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => {
                  const byDay = new Map(row.cells.map((c) => [c.day, c]))
                  return (
                    <tr key={row.cohort_start} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                        {formatCohortStart(row.cohort_start, table.grain)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{row.cohort_size}</td>
                      {days.map((d) => {
                        const cell = byDay.get(d)
                        const pct = cell?.pct ?? null
                        return (
                          <td key={d} className="px-2 py-1.5 text-center">
                            <div className={`rounded-lg py-1.5 ${heatClass(pct)}`}>
                              <div className="font-semibold tabular-nums">
                                {pct === null ? '—' : `${pct}%`}
                              </div>
                              <div className="text-[10px] opacity-70 tabular-nums">
                                {pct === null ? 'not eligible yet' : `${cell?.retained ?? 0}/${cell?.eligible ?? 0}`}
                              </div>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
