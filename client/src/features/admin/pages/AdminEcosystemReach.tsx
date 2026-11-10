/**
 * Ecosystem reach (founder request 2026-11-10). HOCKIA is for the field
 * hockey ecosystem only, so this page answers "how much of the field hockey
 * world is here?" rather than "how much traffic do we get?":
 *
 *   - members by country and role, against the clubs HOCKIA knows in the
 *     world directory (and how many of those clubs are claimed);
 *   - sessions split into relevant (members; visitors with field hockey
 *     intent), unclear, and not relevant (crawler paths, legal-page bounces).
 *
 * Data: admin_get_ecosystem_reach (counts only, test/hidden/admin excluded).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe2, RefreshCw, Users, Building2, Radar } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DonutChartCard } from '../components/charts/DonutChartCard'
import { StackedBarsCard } from '../components/charts/StackedBarsCard'
import { RankedBarsCard } from '../components/charts/RankedBarsCard'
import { getEcosystemReach, type EcosystemCountry } from '../api/adminApi'
import { ROLE_COLORS, shortDay } from '../lib/adminCharts'
import { pct } from '../utils/percent'

type Days = 7 | 28 | 90

const TRAFFIC = [
  { key: 'member', label: 'Members', color: '#7c3aed' },
  { key: 'visitor_hockey_intent', label: 'Visitors with field hockey intent', color: '#10b981' },
  { key: 'unclear', label: 'Unclear (home only, no action)', color: '#f59e0b' },
  { key: 'not_relevant', label: 'Not relevant (crawlers, legal-page bounces)', color: '#94a3b8' },
] as const

function claimedShare(c: EcosystemCountry): string {
  return c.known_clubs > 0 ? `${Math.round((100 * c.claimed_clubs) / c.known_clubs)}%` : '—'
}

export function AdminEcosystemReach() {
  const [days, setDays] = useState<Days>(28)
  const query = useQuery({
    queryKey: ['admin', 'ecosystem-reach', days],
    queryFn: () => getEcosystemReach(days),
    staleTime: 5 * 60 * 1000,
  })
  const data = query.data
  const totals = data?.totals
  const traffic = data?.traffic
  const sessions = traffic ? traffic.member + traffic.visitor_hockey_intent + traffic.unclear + traffic.not_relevant : 0
  const relevant = traffic ? traffic.member + traffic.visitor_hockey_intent : 0
  const countries = data?.countries ?? []
  const weekly = (data?.weekly ?? []).map((w, i, all) => ({ ...w, label: shortDay(w.week), partial: i === all.length - 1 }))
  const loading = query.isLoading

  return (
    <div className="space-y-6" data-testid="admin-ecosystem-reach">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ecosystem reach</h1>
          <p className="text-sm text-gray-500 mt-1">
            How much of the field hockey world is on HOCKIA: members by country against the clubs we know, and the traffic that is actually field hockey.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            title="Traffic window"
          >
            <option value={7}>Last 7 days</option>
            <option value={28}>Last 28 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {query.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load ecosystem reach: {query.error instanceof Error ? query.error.message : String(query.error)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Members"
          value={totals?.members ?? 0}
          icon={Users}
          loading={loading}
          percent={{ value: pct(totals?.active_30d, totals?.members), label: `active in 30 days (${totals?.active_30d ?? 0})` }}
        />
        <StatCard
          label="Countries with members"
          value={totals?.countries_with_members ?? 0}
          icon={Globe2}
          loading={loading}
          percent={{ value: pct(totals?.members_no_country, totals?.members), label: `of members have no country (${totals?.members_no_country ?? 0})` }}
        />
        <StatCard
          label="Clubs in the world directory"
          value={totals?.known_clubs ?? 0}
          icon={Building2}
          loading={loading}
          percent={{ value: pct(totals?.claimed_clubs, totals?.known_clubs), label: `claimed by the club (${totals?.claimed_clubs ?? 0})` }}
        />
        <StatCard
          label={`Relevant sessions (${days}d)`}
          value={relevant}
          icon={Radar}
          loading={loading}
          percent={{ value: pct(relevant, sessions), label: `of ${sessions} sessions` }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DonutChartCard
          title={`Traffic by relevance (${days}d)`}
          hint="Sessions. Relevant = members, and visitors who opened roles, profiles, Community, the world directory, sign-up or a tagged link."
          slices={TRAFFIC.map((t) => ({ label: t.label, value: traffic?.[t.key] ?? 0, color: t.color }))}
          centerLabel="sessions"
          total={sessions}
          loading={loading}
        />
        <div className="lg:col-span-2">
          <StackedBarsCard
            title="Traffic by relevance, per week"
            hint="Last 13 weeks (Monday start); the last bar is the current, partial week."
            rows={weekly}
            series={TRAFFIC.map((t) => ({ key: t.key, label: t.label, color: t.color }))}
            loading={loading}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankedBarsCard
          title="Members by country"
          hint="Country = base country, else nationality."
          bars={countries.filter((c) => c.members > 0).map((c) => ({ label: `${c.flag_emoji ?? ''} ${c.country_name}`.trim(), value: c.members }))}
          total={totals?.members ?? 0}
          limit={10}
          loading={loading}
        />
        <RankedBarsCard
          title="Clubs known per country"
          hint="Clubs in the HOCKIA world directory: what we know, not every club that exists."
          bars={countries.filter((c) => c.known_clubs > 0).sort((a, b) => b.known_clubs - a.known_clubs).map((c) => ({ label: `${c.flag_emoji ?? ''} ${c.country_name}`.trim(), value: c.known_clubs, color: ROLE_COLORS.club }))}
          total={totals?.known_clubs ?? 0}
          limit={10}
          loading={loading}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900">Reach by country</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Members by role against the clubs in the world directory. A low claimed share is where club outreach has room.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="ecosystem-country-table">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Country</th>
                <th className="px-3 py-2 text-right" style={{ color: ROLE_COLORS.player }}>Players</th>
                <th className="px-3 py-2 text-right" style={{ color: ROLE_COLORS.coach }}>Coaches</th>
                <th className="px-3 py-2 text-right" style={{ color: ROLE_COLORS.club }}>Club accounts</th>
                <th className="px-3 py-2 text-right" style={{ color: ROLE_COLORS.umpire }}>Umpires</th>
                <th className="px-3 py-2 text-right" style={{ color: ROLE_COLORS.brand }}>Brands</th>
                <th className="px-3 py-2 text-right">Active 30d</th>
                <th className="px-3 py-2 text-right">Clubs known</th>
                <th className="px-3 py-2 text-right">Claimed</th>
                <th className="px-3 py-2 text-right">Leagues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
              ) : countries.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">No data yet</td></tr>
              ) : (
                countries.map((c) => (
                  <tr key={c.country_code} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{c.flag_emoji} {c.country_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.players}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.coaches}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.club_accounts}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.umpires}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.brands}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.active_30d}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.known_clubs}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.claimed_clubs} <span className="text-gray-400">({claimedShare(c)})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.leagues_known}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          {totals?.members_no_country ?? 0} members have no country yet and are not in the table. England and the United Kingdom are separate entries in the countries list.
        </p>
      </div>
    </div>
  )
}
