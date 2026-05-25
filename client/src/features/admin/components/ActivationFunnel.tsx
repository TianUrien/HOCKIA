import { UserPlus, UserCheck, Eye, FileText, MessageSquare } from 'lucide-react'
import type { ActivationFunnelData } from '../types'

interface ActivationFunnelProps {
  data: ActivationFunnelData | null
  loading?: boolean
}

const STEPS = [
  { key: 'signed_up' as const, label: 'Signed Up', icon: UserPlus, color: 'purple' },
  { key: 'profile_complete' as const, label: 'Profile Complete', icon: UserCheck, color: 'blue' },
  { key: 'browsed_opportunity' as const, label: 'Browsed Opportunity', icon: Eye, color: 'indigo' },
  { key: 'applied' as const, label: 'Applied', icon: FileText, color: 'emerald' },
  { key: 'messaged' as const, label: 'Messaged', icon: MessageSquare, color: 'amber' },
]

const COLORS: Record<string, { bar: string; icon: string }> = {
  purple: { bar: 'bg-purple-500', icon: 'text-purple-500' },
  blue: { bar: 'bg-blue-500', icon: 'text-blue-500' },
  indigo: { bar: 'bg-indigo-500', icon: 'text-indigo-500' },
  emerald: { bar: 'bg-emerald-500', icon: 'text-emerald-500' },
  amber: { bar: 'bg-amber-500', icon: 'text-amber-500' },
}

export function ActivationFunnel({ data, loading }: ActivationFunnelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-4 w-32 bg-gray-200 rounded mb-6" />
        <div className="space-y-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 w-32 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
              <div className="h-7 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const total = data?.signed_up ?? 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-5">Activation Funnel</h3>
      <div className="space-y-5">
        {STEPS.map((step, index) => {
          const value = data?.[step.key] ?? 0
          const percentage = total > 0 ? Math.round((value / total) * 100) : 0
          const widthPct = Math.max(percentage, 4)
          const colors = COLORS[step.color]
          const Icon = step.icon

          const prevValue = index > 0 ? (data?.[STEPS[index - 1].key] ?? 0) : value
          // Cap at 100% — admin_get_activation_funnel migration
          // 20260525140000 makes the data cumulative-union (each step is
          // a strict superset of the next), so this cap should never
          // trigger. Kept as defense-in-depth in case the RPC is rolled
          // back. Pre-fix this rendered as "Browsed Opportunity 175%"
          // (audit Bug 4 / Overview activation funnel).
          const stepConversion = prevValue > 0 ? Math.min(100, Math.round((value / prevValue) * 100)) : 0

          return (
            <div key={step.key} className="space-y-1.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 flex-shrink-0 ${colors.icon}`} />
                  <span className="text-sm font-medium text-gray-700">{step.label}</span>
                </div>
                <div className="flex items-center gap-3 pl-6 sm:pl-0">
                  <span className="text-sm font-bold text-gray-900">{value.toLocaleString()}</span>
                  <span className="text-xs text-gray-500">{percentage}% of total</span>
                </div>
              </div>
              <div className="h-7 bg-gray-100 rounded-lg overflow-hidden">
                <div
                  className={`h-full rounded-lg transition-all duration-500 ${colors.bar}`}
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
    </div>
  )
}
