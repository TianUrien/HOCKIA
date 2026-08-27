/**
 * RetentionSignals — D7 / D15 / D30 on the Overview.
 *
 * One card per checkpoint, each carrying the three things a percentage needs
 * to be trustworthy: the numerator, the eligible denominator, and the change
 * against the preceding equal-length signup period. A cohort that has not
 * aged enough reads "Not enough eligible data" — never 0%, which is what the
 * old single D7 card did and what made an immature cohort look like a crash.
 *
 * The numbers come from admin_get_retention_summary; this component formats
 * them and links through to the full cohort analysis.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import { getRetentionSummary } from '../api/retentionApi'
import type {
  RetentionActivity,
  RetentionCheckpoint,
  RetentionMethod,
  RetentionSummary,
} from '../types/retention'
import {
  MIN_CONFIDENT_ELIGIBLE,
  RETENTION_ACTIVITY_LABEL,
  RETENTION_METHOD_LABEL,
} from '../types/retention'
import { InfoTip } from './InfoTip'
import type { MetricKey } from '../lib/metricInfo'
import { logger } from '@/lib/logger'

const DETAIL_PATH = '/admin/product-health/retention'

const METRIC_KEY_BY_DAY: Record<number, MetricKey> = {
  7: 'd7Retention',
  15: 'd15Retention',
  30: 'd30Retention',
}

function statusFor(day: number, pct: number | null): 'green' | 'yellow' | 'red' | 'muted' {
  if (pct === null) return 'muted'
  // Later checkpoints are held to a lower bar — the curve is meant to decay.
  const good = day <= 7 ? 20 : day <= 15 ? 15 : 12
  const ok = day <= 7 ? 10 : day <= 15 ? 8 : 6
  if (pct >= good) return 'green'
  if (pct >= ok) return 'yellow'
  return 'red'
}

const CARD_BG: Record<string, string> = {
  green: 'bg-emerald-50 border-emerald-100',
  yellow: 'bg-amber-50 border-amber-100',
  red: 'bg-red-50 border-red-100',
  muted: 'bg-gray-50 border-gray-200',
}

const DOT: Record<string, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
  muted: 'bg-gray-300',
}

export function RetentionCard({
  checkpoint,
  method,
  activity,
  periodDays,
}: {
  checkpoint: RetentionCheckpoint
  method: RetentionMethod
  activity: RetentionActivity
  periodDays: number
}) {
  const { day, pct, retained, eligible, delta_pts: delta } = checkpoint
  const status = statusFor(day, pct)
  const lowConfidence = pct !== null && eligible > 0 && eligible < MIN_CONFIDENT_ELIGIBLE
  const metricKey = METRIC_KEY_BY_DAY[day]

  return (
    <div
      data-testid={`retention-card-d${day}`}
      className={`rounded-xl border p-4 ${CARD_BG[status]}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-2 h-2 rounded-full ${DOT[status]}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          D{day} Retention
        </span>
        {metricKey && (
          <InfoTip
            metric={metricKey}
            value={pct ?? undefined}
            interpretation={
              pct === null
                ? `No member who signed up in the last ${periodDays} days has completed the day-${day} window yet, so there is nothing to measure.`
                : `${retained} of ${eligible} eligible members came back. ${RETENTION_METHOD_LABEL[method]}; ${RETENTION_ACTIVITY_LABEL[activity].toLowerCase()}.`
            }
          />
        )}
      </div>

      {pct === null ? (
        <>
          <p className="text-lg font-bold text-gray-400">N/A</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Not enough eligible data{checkpoint.cohort_size > 0 ? ` · ${checkpoint.cohort_size} still maturing` : ''}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-bold text-gray-900">{pct}%</p>
            {delta !== null && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
                  delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-gray-500'
                }`}
                title="Change vs the preceding equal-length signup period"
              >
                {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                {delta > 0 ? '+' : ''}{delta} pts
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 mt-0.5 tabular-nums">
            {retained} of {eligible} eligible
          </p>
          {lowConfidence && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              Small cohort — read as a direction, not a rate
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function RetentionSignals({ periodDays = 90 }: { periodDays?: number }) {
  const [summary, setSummary] = useState<RetentionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getRetentionSummary({ periodDays })
      .then((data) => {
        if (cancelled) return
        setSummary(data)
        setError(null)
      })
      .catch((err) => {
        logger.error('[RetentionSignals] load failed', err)
        if (!cancelled) setError('Could not load retention.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [periodDays])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Retention — do members come back?</h3>
          <p className="text-xs text-gray-500">
            Signups in the last {periodDays} days ·{' '}
            {summary ? RETENTION_METHOD_LABEL[summary.method] : 'returned that week (days N–N+6)'} ·{' '}
            {summary ? RETENTION_ACTIVITY_LABEL[summary.activity].toLowerCase() : 'any active return'} · UTC
          </p>
        </div>
        <Link
          to={DETAIL_PATH}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 shrink-0"
        >
          Cohorts &amp; segments <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading && (
        <div data-testid="retention-loading" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[7, 15, 30].map((d) => (
            <div key={d} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
              <div className="h-5 w-14 bg-gray-200 rounded mb-2" />
              <div className="h-2 w-24 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div
          data-testid="retention-error"
          className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!loading && !error && summary && summary.checkpoints.length === 0 && (
        <div
          data-testid="retention-empty"
          className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3"
        >
          No signups in this window yet.
        </div>
      )}

      {!loading && !error && summary && summary.checkpoints.length > 0 && (
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
    </div>
  )
}
