/**
 * RegistrationFunnel — the web/PWA acquisition funnel (registered half).
 *
 * Source = Supabase only (profiles + the first-party `events` table), so the
 * numbers are EXACT and bot-free (test accounts excluded). The anonymous
 * top-of-funnel (visits → CTA → signup wall → signup started) lives only in
 * GA4 (the Ga4TopFunnel card above this one); this card owns what we can count
 * precisely: account creation onward.
 *
 * Steps are cumulative-union in the RPC (each step ⊇ the next), so step
 * conversion + drop-off are always in [0, 100%].
 */

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, BadgeCheck, PlayCircle, CheckCircle2, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react'
import { getRegistrationFunnel } from '../api/adminApi'
import type { RegistrationFunnelData } from '../types'
import { logger } from '@/lib/logger'

type FunnelKey = keyof RegistrationFunnelData['funnel']

const STEPS: { key: FunnelKey; label: string; icon: typeof UserPlus; bar: string; iconColor: string }[] = [
  { key: 'account_created', label: 'Account created', icon: UserPlus, bar: 'bg-purple-500', iconColor: 'text-purple-500' },
  { key: 'role_selected', label: 'Role selected', icon: BadgeCheck, bar: 'bg-blue-500', iconColor: 'text-blue-500' },
  { key: 'onboarding_started', label: 'Onboarding started', icon: PlayCircle, bar: 'bg-indigo-500', iconColor: 'text-indigo-500' },
  { key: 'onboarding_completed', label: 'Onboarding completed', icon: CheckCircle2, bar: 'bg-emerald-500', iconColor: 'text-emerald-500' },
  { key: 'activated', label: 'Activated · first real action', icon: Sparkles, bar: 'bg-amber-500', iconColor: 'text-amber-500' },
]

const DATE_OPTIONS: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '15d', days: 15 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
]

const ROLES = ['all', 'player', 'coach', 'club', 'brand', 'umpire']

export function RegistrationFunnel() {
  const [days, setDays] = useState<number | null>(30)
  const [role, setRole] = useState<string>('all')
  const [data, setData] = useState<RegistrationFunnelData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getRegistrationFunnel(days, role === 'all' ? null : role)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        logger.error('[RegistrationFunnel] fetch failed:', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setData(null)
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [days, role])

  useEffect(() => {
    const cancel = fetchData()
    return cancel
  }, [fetchData])

  const total = data?.funnel.account_created ?? 0
  const byRole = data ? Object.entries(data.by_role).sort((a, b) => b[1].account_created - a[1].account_created) : []
  const byCountry = data?.by_country ?? []

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header + filters (always visible so controls don't jump on reload) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Registration Funnel</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Web · real accounts only (bots &amp; test excluded). Exact, from Supabase.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {DATE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setDays(opt.days)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  days === opt.days ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Filter registration funnel by role"
            className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white capitalize focus:outline-none focus:ring-2 focus:ring-purple-200"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-5 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
              <div className="h-7 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 break-words">{error}</p>
            <button
              type="button"
              onClick={() => fetchData()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      ) : total === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          No accounts created in this range{role !== 'all' ? ` for ${role}s` : ''}.
        </p>
      ) : (
        <>
          {/* Funnel steps */}
          <div className="space-y-5">
            {STEPS.map((step, index) => {
              const value = data?.funnel[step.key] ?? 0
              const percentage = total > 0 ? Math.round((value / total) * 100) : 0
              const widthPct = Math.max(percentage, 4)
              const Icon = step.icon
              const prevValue = index > 0 ? (data?.funnel[STEPS[index - 1].key] ?? 0) : value
              const stepConversion = prevValue > 0 ? Math.min(100, Math.round((value / prevValue) * 100)) : 0

              return (
                <div key={step.key} className="space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${step.iconColor}`} />
                      <span className="text-sm font-medium text-gray-700">{step.label}</span>
                    </div>
                    <div className="flex items-center gap-3 pl-6 sm:pl-0">
                      <span className="text-sm font-bold text-gray-900">{value.toLocaleString()}</span>
                      <span className="text-xs text-gray-500">{percentage}% of total</span>
                    </div>
                  </div>
                  <div className="h-7 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className={`h-full rounded-lg transition-all duration-500 ${step.bar}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  {index > 0 && (
                    <p className="text-xs text-gray-400 pl-6">
                      {stepConversion}% from {STEPS[index - 1].label}
                      {stepConversion < 100 && (
                        <span className="text-gray-300"> &middot; {100 - stepConversion}% drop-off</span>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* By-role completion */}
          {byRole.length > 0 && (
            <div className="mt-6 pt-5 border-t border-gray-100">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Onboarding completion by role</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left py-1.5 font-medium">Role</th>
                      <th className="text-right py-1.5 font-medium">Accounts</th>
                      <th className="text-right py-1.5 font-medium">Completed</th>
                      <th className="text-right py-1.5 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRole.map(([roleName, r]) => (
                      <tr key={roleName} className="border-t border-gray-50">
                        <td className="py-2 text-gray-700 capitalize">{roleName}</td>
                        <td className="py-2 text-right text-gray-500 font-mono">{r.account_created}</td>
                        <td className="py-2 text-right text-gray-700 font-mono">{r.onboarding_completed}</td>
                        <td className={`py-2 text-right font-semibold ${r.completion_rate < 50 ? 'text-amber-600' : 'text-green-600'}`}>
                          {r.completion_rate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By-country (sparse — base_country_id only ~25% populated) */}
          {byCountry.length > 0 && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Top countries</h4>
              <p className="text-[11px] text-gray-400 mb-3">Where known — most accounts have no country yet, shown as “Unknown”.</p>
              <div className="flex flex-wrap gap-2">
                {byCountry.map((c) => (
                  <span key={c.country} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">
                    <span className="text-gray-700 font-medium">{c.country}</span>
                    <span className="text-gray-400 font-mono">{c.account_created}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 text-[11px] text-gray-400 leading-relaxed">
            “Role selected” is ~100% because role is chosen at signup — it’s not a drop-off point.
            The anonymous top of funnel (visits → sign-up CTA → wall → signup started) is the
            GA4 estimate card above.
          </p>
        </>
      )}
    </div>
  )
}
