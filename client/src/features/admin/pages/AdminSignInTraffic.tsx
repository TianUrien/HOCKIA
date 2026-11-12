/**
 * AdminSignInTraffic — who is starting sign-ins and sign-ups, per network and
 * device (brief 2026-11-11, after automated OAuth starts in production).
 * Networks and devices are shown as short hash tags: enough to see "the same
 * source again", never an address. "Would be limited" is the number to read
 * before turning the rate limit on: real members in it mean the thresholds
 * are too tight. Nothing on this page changes a setting.
 * Data: admin_get_auth_attempts.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { DataTable } from '../components'
import type { Column } from '../components'
import { getAuthAttempts } from '../api/adminApi'
import type { AuthAttemptSource, AuthAttemptsSummary } from '../api/adminApi'
import { formatAdminDateTime } from '../utils/formatDate'
import { logger } from '@/lib/logger'

const WINDOWS = [
  { hours: 1, label: 'Last hour' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
]

const KIND_LABEL: Record<string, string> = {
  oauth_start: 'Apple / Google / Facebook starts',
  password_signin: 'Password sign-ins started',
  password_signin_failed: 'Password sign-ins failed',
  signup: 'Email sign-ups started',
  magic_link: 'Magic links requested',
  password_reset: 'Password resets requested',
  user_created: 'New accounts created',
}

type Row = AuthAttemptSource & { id: string }

function SwitchPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
      {label}: {on ? 'on' : 'off'}
    </span>
  )
}

export function AdminSignInTraffic() {
  const [hours, setHours] = useState(24)
  const [summary, setSummary] = useState<AuthAttemptsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSummary(await getAuthAttempts(hours))
    } catch (err) {
      logger.error('[AdminSignInTraffic] load failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load sign-in traffic')
    } finally {
      setLoading(false)
    }
  }, [hours])

  useEffect(() => { void load() }, [load])

  const byKind = new Map<string, { total: number; wouldLimit: number; refused: number }>()
  for (const t of summary?.totals ?? []) {
    const k = byKind.get(t.kind) ?? { total: 0, wouldLimit: 0, refused: 0 }
    k.total += t.attempts
    if (t.outcome === 'would_limit') k.wouldLimit += t.attempts
    if (t.outcome === 'rate_limited' || t.outcome === 'captcha_required' || t.outcome === 'captcha_failed') k.refused += t.attempts
    byKind.set(t.kind, k)
  }

  const rows: Row[] = (summary?.sources ?? []).map((s, i) => ({ ...s, id: `${s.network ?? 'none'}-${s.device ?? 'none'}-${i}` }))

  const columns: Column<Row>[] = [
    {
      key: 'network',
      label: 'Network · device',
      render: (_, row) => (
        <div className="min-w-[200px]">
          <div className="font-mono text-xs text-gray-900">{row.network ?? 'unknown'} · {row.device ?? 'server'}</div>
          <div className="mt-1 text-xs text-gray-500">
            {[row.device_label ?? 'Seen by the server only', row.platform, row.app_version, row.country].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    { key: 'attempts', label: 'Attempts' },
    { key: 'oauth_starts', label: 'Social starts' },
    { key: 'failed_signins', label: 'Failed passwords' },
    { key: 'new_accounts', label: 'New accounts' },
    {
      key: 'would_limit',
      label: 'Would be limited',
      render: (_, row) => row.would_limit > 0
        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{row.would_limit}</span>
        : <span className="text-gray-400">0</span>,
    },
    { key: 'refused', label: 'Refused' },
    {
      key: 'last_seen',
      label: 'First – last seen',
      render: (_, row) => <span className="whitespace-nowrap text-xs text-gray-600">{formatAdminDateTime(row.first_seen)} – {formatAdminDateTime(row.last_seen)}</span>,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ShieldCheck className="h-6 w-6 text-gray-500" />
            Sign-in traffic
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Sign-in and sign-up attempts by network and device. Networks and devices are shown as codes, never as addresses. Apps installed before this was added only appear under new accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="traffic-window">Period</label>
          <select
            id="traffic-window"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
          >
            {WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { void load() }}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {summary && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <SwitchPill on={summary.rate_limit_enabled} label="Rate limit" />
            <SwitchPill on={summary.turnstile_enforced} label="Bot check required" />
            <span className="text-xs text-gray-500">
              Limits: {summary.device_max} per device and {summary.ip_max} per network every {Math.round(summary.window_seconds / 60)} minutes; {summary.signups_per_hour} new accounts per network per hour.
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.keys(KIND_LABEL).map((kind) => {
              const k = byKind.get(kind) ?? { total: 0, wouldLimit: 0, refused: 0 }
              return (
                <div key={kind} className="rounded-lg bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">{KIND_LABEL[kind]}</dt>
                  <dd className="mt-1 text-xl font-semibold text-gray-900">{k.total}</dd>
                  {(k.wouldLimit > 0 || k.refused > 0) && (
                    <dd className="mt-0.5 text-xs text-gray-500">
                      {k.wouldLimit > 0 && `${k.wouldLimit} would be limited`}
                      {k.wouldLimit > 0 && k.refused > 0 && ' · '}
                      {k.refused > 0 && `${k.refused} refused`}
                    </dd>
                  )}
                </div>
              )
            })}
          </dl>
        </div>
      )}

      <section className="space-y-3" aria-labelledby="traffic-sources-title">
        <h2 id="traffic-sources-title" className="text-lg font-semibold text-gray-900">Busiest sources</h2>
        <DataTable
          data={rows}
          columns={columns}
          keyField="id"
          loading={loading}
          emptyMessage="No sign-in or sign-up attempts recorded in this period."
        />
      </section>
    </div>
  )
}
