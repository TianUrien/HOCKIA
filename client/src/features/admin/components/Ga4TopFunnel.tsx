/**
 * Ga4TopFunnel — the ANONYMOUS top-of-funnel (Phase 1C), from the GA4 Data API.
 *
 * This is an ESTIMATE (GA4: web + consented + bot-filtered, lags 24–48h), unlike
 * the exact Supabase RegistrationFunnel directly below it — the two cards read as
 * different-source / different-precision ON PURPOSE. We deliberately do NOT
 * compute conversion % across the GA→Supabase boundary; % math stays inside each
 * card. It flows visually down into RegistrationFunnel's "Account created".
 */

import { useCallback, useEffect, useState } from 'react'
import { Eye, MousePointerClick, Lock, LogIn, UserPlus, AlertTriangle, RefreshCw } from 'lucide-react'
import { getGa4Funnel } from '../api/adminApi'
import type { Ga4FunnelData } from '../types'
import { logger } from '@/lib/logger'

type CountKey = keyof NonNullable<Ga4FunnelData['counts']>

const STEPS: { key: CountKey; label: string; icon: typeof Eye; bar: string; iconColor: string }[] = [
  { key: 'page_view_landing', label: 'Landing page viewed', icon: Eye, bar: 'bg-sky-500', iconColor: 'text-sky-500' },
  { key: 'signup_cta_click', label: 'Sign-up CTA clicked', icon: MousePointerClick, bar: 'bg-cyan-500', iconColor: 'text-cyan-500' },
  { key: 'protected_action_blocked', label: 'Sign-up wall shown', icon: Lock, bar: 'bg-teal-500', iconColor: 'text-teal-500' },
  { key: 'signup_wall_action_clicked', label: 'Wall → clicked to join', icon: LogIn, bar: 'bg-emerald-500', iconColor: 'text-emerald-500' },
  { key: 'sign_up_start', label: 'Sign-up started', icon: UserPlus, bar: 'bg-purple-500', iconColor: 'text-purple-500' },
]

const DATE_OPTIONS = [7, 15, 30, 90]

export function Ga4TopFunnel() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<Ga4FunnelData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getGa4Funnel(days)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        logger.error('[Ga4TopFunnel] fetch failed:', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setData(null)
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [days])

  useEffect(() => {
    const cancel = fetchData()
    return cancel
  }, [fetchData])

  const counts = data?.counts ?? null
  const total = counts?.page_view_landing ?? 0
  // Surface a GA-side error (configured but the GA call failed) like a fetch error.
  const gaError = error ?? (data && data.configured && data.error ? data.error : null)
  const isPermissionError = !!gaError && gaError.includes('PERMISSION_DENIED')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Acquisition Funnel · Anonymous (GA4)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            GA4 estimate · web + consented · bot-filtered by GA · lags 24–48h
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden self-start">
          {DATE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setDays(opt)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                days === opt ? 'bg-sky-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt}d
            </button>
          ))}
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
      ) : gaError ? (
        <div className="flex items-start gap-3 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-600 break-words">
              {isPermissionError
                ? 'GA4 access not granted yet — enable the Analytics Data API and add the service account as a property Viewer.'
                : gaError}
            </p>
            <button
              type="button"
              onClick={() => fetchData()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 hover:text-sky-700"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      ) : data && !data.configured ? (
        <div className="text-center py-8">
          <Lock className="w-6 h-6 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">GA4 top-of-funnel isn’t connected yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Add the GA4 service-account secrets to enable this card — the funnel below (Supabase) is unaffected.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-5">
            {STEPS.map((step, index) => {
              const value = counts?.[step.key] ?? 0
              const hasValue = value > 0
              const percentage = total > 0 ? Math.round((value / total) * 100) : 0
              const widthPct = total > 0 ? Math.max(percentage, hasValue ? 4 : 0) : 0
              const Icon = step.icon
              const prevValue = index > 0 ? (counts?.[STEPS[index - 1].key] ?? 0) : value
              const stepConversion = prevValue > 0 ? Math.min(100, Math.round((value / prevValue) * 100)) : 0

              return (
                <div key={step.key} className="space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${step.iconColor}`} />
                      <span className="text-sm font-medium text-gray-700">{step.label}</span>
                    </div>
                    <div className="flex items-center gap-3 pl-6 sm:pl-0">
                      <span className="text-sm font-bold text-gray-900">{hasValue ? value.toLocaleString() : '—'}</span>
                      {hasValue && total > 0 && <span className="text-xs text-gray-500">{percentage}% of landing</span>}
                    </div>
                  </div>
                  <div className="h-7 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className={`h-full rounded-lg transition-all duration-500 ${step.bar}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  {index > 0 && hasValue && prevValue > 0 && (
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

          <p className="mt-5 text-[11px] text-gray-400 leading-relaxed">
            Flows into “Account created” in the Registration Funnel below (exact, from Supabase).
            We don’t show conversion % across the two — they’re different sources at different precision.
            New events (CTA click, wall click) will read “—” until GA4 accrues data over the next days.
          </p>
        </>
      )}
    </div>
  )
}
