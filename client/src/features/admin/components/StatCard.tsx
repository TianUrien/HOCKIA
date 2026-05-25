/**
 * StatCard Component
 * 
 * Displays a single statistic with optional trend indicator.
 */

import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number | string
  icon?: LucideIcon
  trend?: {
    /** number for raw counts (auto-locale-formatted), or string for
     *  preformatted values like "-100%" where the unit must be glued
     *  to the number so it doesn't visually split across line wraps. */
    value: number | string
    label: string
    direction: 'up' | 'down' | 'neutral'
  }
  color?: 'purple' | 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'rose'
  loading?: boolean
}

const colorClasses = {
  purple: {
    bg: 'bg-purple-50',
    icon: 'text-purple-600',
    trend: 'text-purple-600',
  },
  blue: {
    bg: 'bg-blue-50',
    icon: 'text-blue-600',
    trend: 'text-blue-600',
  },
  green: {
    bg: 'bg-green-50',
    icon: 'text-green-600',
    trend: 'text-green-600',
  },
  amber: {
    bg: 'bg-amber-50',
    icon: 'text-amber-600',
    trend: 'text-amber-600',
  },
  red: {
    bg: 'bg-red-50',
    icon: 'text-red-600',
    trend: 'text-red-600',
  },
  gray: {
    bg: 'bg-gray-50',
    icon: 'text-gray-600',
    trend: 'text-gray-600',
  },
  rose: {
    bg: 'bg-rose-50',
    icon: 'text-rose-600',
    trend: 'text-rose-600',
  },
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  color = 'purple',
  loading = false,
}: StatCardProps) {
  const colors = colorClasses[color]

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-8 w-8 bg-gray-200 rounded-lg" />
        </div>
        <div className="h-8 w-20 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-16 bg-gray-200 rounded" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        {Icon && (
          <div className={`p-2 rounded-lg ${colors.bg}`}>
            <Icon className={`w-4 h-4 ${colors.icon}`} />
          </div>
        )}
      </div>
      
      <div className="text-2xl font-bold text-gray-900 mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      
      {trend && (
        <div className="flex items-center gap-1 text-xs">
          {trend.direction === 'up' && (
            <TrendingUp className="w-3 h-3 text-green-500" />
          )}
          {trend.direction === 'down' && (
            <TrendingDown className="w-3 h-3 text-red-500" />
          )}
          <span
            className={
              trend.direction === 'up'
                ? 'text-green-600'
                : trend.direction === 'down'
                ? 'text-red-600'
                : 'text-gray-500'
            }
          >
            {/* '+' only on direction='up' (a positive delta). For
                neutral (a raw count like "% of users" or "signups in
                last 30d") the prefix would mislead — audit Bug 7.
                The number-vs-string guard keeps preformatted values
                like "-100%" intact (QA pass 3 finding: trends without
                a unit suffix glued to the number read as raw counts). */}
            {trend.direction === 'up' && typeof trend.value === 'number' && trend.value > 0 ? '+' : ''}
            {typeof trend.value === 'number' ? trend.value.toLocaleString() : trend.value}
          </span>
          <span className="text-gray-400">{trend.label}</span>
        </div>
      )}
    </div>
  )
}
