import type { CommandCenterStats } from '../types'

// D7 lived here as a bare percentage with no denominator, computed by a
// different query than the Retention tab used. It now sits in
// <RetentionSignals> alongside D15/D30, on the shared retention service.

interface HealthSignalsProps {
  stats: CommandCenterStats | null
  loading?: boolean
}

interface Signal {
  label: string
  value: string
  status: 'green' | 'yellow' | 'red'
  tooltip: string
}

function getWauMauStatus(ratio: number): 'green' | 'yellow' | 'red' {
  if (ratio >= 25) return 'green'
  if (ratio >= 15) return 'yellow'
  return 'red'
}

function getProfileCompletionStatus(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 50) return 'green'
  if (pct >= 30) return 'yellow'
  return 'red'
}

function getRoleBalanceStatus(stats: CommandCenterStats): 'green' | 'yellow' | 'red' {
  const { player, coach, club, brand } = stats.role_distribution
  const total = player + coach + club + brand
  if (total === 0) return 'red'
  const maxPct = Math.max(player, coach, club, brand) / total * 100
  if (maxPct > 85) return 'red'
  if (maxPct > 70) return 'yellow'
  return 'green'
}

const STATUS_COLORS = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
}

const STATUS_BG = {
  green: 'bg-emerald-50 border-emerald-100',
  yellow: 'bg-amber-50 border-amber-100',
  red: 'bg-red-50 border-red-100',
}

export function HealthSignals({ stats, loading }: HealthSignalsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
            <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
            <div className="h-5 w-12 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!stats) return null

  const signals: Signal[] = [
    {
      label: 'WAU/MAU',
      value: `${stats.wau_mau_ratio}%`,
      status: getWauMauStatus(stats.wau_mau_ratio),
      tooltip: 'Weekly to Monthly active ratio. Green: >=25%, Yellow: >=15%',
    },
    {
      label: 'Profile Complete',
      value: `${stats.profile_completion_pct}%`,
      status: getProfileCompletionStatus(stats.profile_completion_pct),
      tooltip: 'Users with avatar + bio. Green: >=50%, Yellow: >=30%',
    },
    {
      label: 'Role Balance',
      value: (() => {
        const { player, coach, club, brand } = stats.role_distribution
        const total = player + coach + club + brand
        if (total === 0) return '—'
        const maxPct = Math.round(Math.max(player, coach, club, brand) / total * 100)
        return `${maxPct}% max`
      })(),
      status: getRoleBalanceStatus(stats),
      tooltip: 'Largest role share. Green: <70%, Yellow: <85%',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {signals.map((signal) => (
        <div
          key={signal.label}
          className={`rounded-xl border p-4 ${STATUS_BG[signal.status]}`}
          title={signal.tooltip}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[signal.status]}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {signal.label}
            </span>
          </div>
          <p className="text-lg font-bold text-gray-900">{signal.value}</p>
        </div>
      ))}
    </div>
  )
}
