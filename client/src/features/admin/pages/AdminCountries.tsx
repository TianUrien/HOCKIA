/**
 * AdminCountries — Countries & Nationalities analytics.
 *
 * Answers: which countries are represented, % of users/players/coaches per
 * country, dual-nationality count, EU eligibility (overall + per role), and
 * how much nationality data is missing.
 *
 * Per-country counts use the "count every nationality" method (a dual AR+IT
 * user is counted under BOTH), so country %s can exceed 100% — disclaimed in
 * the UI. EU eligibility is per-user (≤100%).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe2, RefreshCw, AlertTriangle, Users, Flag as FlagIcon, UserX, Layers } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { CategoryBreakdownChart } from '../components/CategoryBreakdownChart'
import { getCountryAnalytics } from '../api/analyticsApi'
import type { CountryAnalytics, CountryAnalyticsFilters } from '../types'
import Flag from '@/components/Flag'
import CountrySelect from '@/components/CountrySelect'
import { logger } from '@/lib/logger'

const ROLE_OPTIONS = ['player', 'coach', 'club', 'brand', 'umpire'] as const

const REGION_COLORS: Record<string, string> = {
  Europe: '#3b82f6',
  'South America': '#22c55e',
  Africa: '#f59e0b',
  Asia: '#8b5cf6',
  'North America': '#ef4444',
  'Central America': '#ec4899',
  Caribbean: '#14b8a6',
  Oceania: '#6366f1',
}

const TOP_BAR_LIMIT = 12

export function AdminCountries() {
  const [filters, setFilters] = useState<CountryAnalyticsFilters>({})
  const [data, setData] = useState<CountryAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getCountryAnalytics(filters)
      setData(result)
    } catch (err) {
      logger.error('[AdminCountries] fetch failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load country analytics')
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  useEffect(() => {
    document.title = 'Countries | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const summary = data?.summary
  const countries = useMemo(() => data?.by_country ?? [], [data])
  const maxCount = useMemo(() => Math.max(...countries.map((c) => c.count), 1), [countries])

  // EU eligibility donut: eligible / non-EU (with nationality) / unknown.
  const euSegments = useMemo(() => {
    if (!summary) return []
    const nonEu = Math.max(0, summary.with_nationality - summary.eu_eligible)
    return [
      { label: 'EU eligible', value: summary.eu_eligible, color: '#3b82f6' },
      { label: 'Non-EU', value: nonEu, color: '#94a3b8' },
      { label: 'Unknown', value: summary.missing_nationality, color: '#e5e7eb' },
    ]
  }, [summary])

  // Continent donut (primary nationality) + an explicit Unknown slice.
  const regionSegments = useMemo(() => {
    const segs = (data?.by_region ?? []).map((r) => ({
      label: r.region,
      value: r.count,
      color: REGION_COLORS[r.region] ?? '#cbd5e1',
    }))
    if (summary?.missing_nationality) {
      segs.push({ label: 'Unknown', value: summary.missing_nationality, color: '#e5e7eb' })
    }
    return segs
  }, [data?.by_region, summary])

  const updateFilter = (patch: Partial<CountryAnalyticsFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch }
      // Prune undefined keys so "Clear filters" reflects only active filters.
      for (const k of Object.keys(next) as (keyof CountryAnalyticsFilters)[]) {
        if (next[k] === undefined) delete next[k]
      }
      return next
    })

  const selectClass =
    'text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500'

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load country analytics</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button type="button" onClick={fetchData} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-purple-600" /> Countries &amp; Nationalities
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Where HOCKIA&apos;s members are from, dual nationality, and EU eligibility.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <select aria-label="Filter by role" className={selectClass} value={filters.role ?? ''}
          onChange={(e) => updateFilter({ role: e.target.value || undefined })}>
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}s</option>)}
        </select>
        <div className="w-56">
          <CountrySelect value={filters.country_id ?? null} onChange={(id) => updateFilter({ country_id: id ?? undefined })} placeholder="Any nationality" />
        </div>
        <select aria-label="Filter by profile completeness" className={selectClass} value={filters.min_completeness ?? ''}
          onChange={(e) => updateFilter({ min_completeness: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Any completeness</option>
          <option value="50">≥ 50% complete</option>
          <option value="80">≥ 80% complete</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!filters.active} onChange={(e) => updateFilter({ active: e.target.checked || undefined })} />
          Active (30d)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!filters.open_to_play} onChange={(e) => updateFilter({ open_to_play: e.target.checked || undefined })} />
          Open to play
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!filters.open_to_coach} onChange={(e) => updateFilter({ open_to_coach: e.target.checked || undefined })} />
          Open to coach
        </label>
        {Object.keys(filters).length > 0 && (
          <button type="button" onClick={() => setFilters({})} className="text-sm text-purple-600 hover:text-purple-700 ml-auto">
            Clear filters
          </button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="EU Eligible" value={summary?.eu_eligible ?? 0} icon={FlagIcon} color="blue" loading={isLoading}
          percent={{ value: summary?.eu_eligible_pct ?? null, label: 'of total users' }} />
        <StatCard label="Dual Nationality" value={summary?.dual_nationality ?? 0} icon={Layers} color="purple" loading={isLoading}
          percent={{ value: summary?.dual_nationality_pct ?? null, label: 'of total users' }} />
        <StatCard label="Nationality Missing" value={summary?.missing_nationality ?? 0} icon={UserX} color="amber" loading={isLoading}
          percent={{ value: summary?.missing_nationality_pct ?? null, label: 'of total users' }} />
        <StatCard label="With Nationality" value={summary?.with_nationality ?? 0} icon={Users} color="green" loading={isLoading}
          percent={{ value: summary?.with_nationality_pct ?? null, label: 'of total users' }} />
      </div>

      {!isLoading && summary && summary.total_users < 50 && (
        <p className="text-xs text-gray-500 -mt-2">
          Percentages are directional at the current sample size ({summary.total_users.toLocaleString()} users).
        </p>
      )}

      {/* Donuts: EU eligibility + Continent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">EU Eligibility</h2>
          <CategoryBreakdownChart segments={euSegments} centerLabel="Users" loading={isLoading} />
          <p className="text-xs text-gray-500 mt-3">
            Players, coaches &amp; umpires = holds an EU passport (either nationality). Clubs &amp; brands =
            based in an EU country.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">By Continent</h2>
          <p className="text-xs text-gray-500 mb-4">By each user&apos;s primary nationality.</p>
          <CategoryBreakdownChart segments={regionSegments} centerLabel="Users" loading={isLoading} />
        </div>
      </div>

      {/* Per-role EU eligibility */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">EU Eligibility by Role</h2>
        <p className="text-xs text-gray-500 -mt-3 mb-4">
          For clubs &amp; brands this reflects their <em>country</em> (based in an EU country), not a passport.
        </p>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-medium">Role</th>
                  <th className="text-right py-2 px-2 font-medium">Users</th>
                  <th className="text-right py-2 px-2 font-medium">EU eligible</th>
                  <th className="text-right py-2 px-2 font-medium">Dual</th>
                  <th className="text-right py-2 px-2 font-medium">Missing</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_role ?? []).map((r) => (
                  <tr key={r.role} className="border-b border-gray-100">
                    <td className="py-2 px-2 capitalize font-medium text-gray-900">{r.role}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.total.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono text-blue-700">{r.eu_eligible} <span className="text-gray-400">({r.eu_eligible_pct ?? 0}%)</span></td>
                    <td className="py-2 px-2 text-right font-mono">{r.dual} <span className="text-gray-400">({r.dual_pct ?? 0}%)</span></td>
                    <td className="py-2 px-2 text-right font-mono text-amber-700">{r.missing} <span className="text-gray-400">({r.missing_pct ?? 0}%)</span></td>
                  </tr>
                ))}
                {(data?.by_role ?? []).length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray-400 py-6">No data for these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dual-nationality disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>Users may have more than one nationality, so country totals below can exceed 100% (each dual-nationality user is counted under both of their countries).</span>
      </div>

      {/* Top countries bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Nationalities</h2>
        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-7 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : countries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No nationality data for these filters.</p>
        ) : (
          <div className="space-y-2.5">
            {countries.slice(0, TOP_BAR_LIMIT).map((c) => (
              <div key={c.country_id}>
                <div className="flex items-center justify-between mb-1 text-sm">
                  <span className="flex items-center gap-2 text-gray-700">
                    <Flag code={c.code} fallbackEmoji={c.flag_emoji ?? undefined} countryName={c.name} size="sm" />
                    {c.name}
                    {c.is_eu && <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">EU</span>}
                  </span>
                  <span className="font-mono text-gray-600">
                    {c.count} <span className="text-gray-400">({c.pct_total ?? 0}%)</span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="h-2 rounded-full bg-purple-500 transition-all" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">All Nationalities</h2>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : countries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No nationality data for these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-medium">Country</th>
                  <th className="text-center py-2 px-2 font-medium">EU</th>
                  <th className="text-right py-2 px-2 font-medium">Users</th>
                  <th className="text-right py-2 px-2 font-medium">% total</th>
                  <th className="text-right py-2 px-2 font-medium">Players</th>
                  <th className="text-right py-2 px-2 font-medium">% players</th>
                  <th className="text-right py-2 px-2 font-medium">Coaches</th>
                  <th className="text-right py-2 px-2 font-medium">% coaches</th>
                  <th className="text-right py-2 px-2 font-medium">Clubs</th>
                  <th className="text-right py-2 px-2 font-medium">Umpires</th>
                  <th className="text-right py-2 px-2 font-medium">Brands</th>
                </tr>
              </thead>
              <tbody>
                {countries.map((c) => (
                  <tr key={c.country_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-2">
                      <span className="flex items-center gap-2 text-gray-900">
                        <Flag code={c.code} fallbackEmoji={c.flag_emoji ?? undefined} countryName={c.name} size="sm" />
                        {c.name}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">{c.is_eu ? <span className="text-blue-600 font-semibold">✓</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-900">{c.count}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">{c.pct_total ?? 0}%</td>
                    <td className="py-2 px-2 text-right font-mono">{c.players}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">{c.players_pct ?? 0}%</td>
                    <td className="py-2 px-2 text-right font-mono">{c.coaches}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">{c.coaches_pct ?? 0}%</td>
                    <td className="py-2 px-2 text-right font-mono">{c.clubs}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.umpires}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.brands}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data?.generated_at && (
        <p className="text-xs text-gray-400 text-center">Counts exclude test accounts.</p>
      )}
    </div>
  )
}
