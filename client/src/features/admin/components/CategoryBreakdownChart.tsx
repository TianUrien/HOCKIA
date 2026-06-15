/**
 * CategoryBreakdownChart Component
 *
 * Generic donut chart + legend for a small set of mutually-exclusive
 * categories (role split, device/platform split, etc.) shown with
 * %-of-total. Generalizes RoleBreakdownChart so any {label, value, color}[]
 * can be rendered. Zero-value segments are dropped, so a category with no
 * users yet (e.g. umpires before a campaign) simply appears once it has data.
 */

import { useMemo } from 'react'

export interface CategorySegment {
  label: string
  value: number
  color: string
}

interface CategoryBreakdownChartProps {
  segments: CategorySegment[]
  /** Label under the total in the donut center (e.g. "Total", "Devices"). */
  centerLabel?: string
  loading?: boolean
  /** Shown when every segment is zero. */
  emptyMessage?: string
}

export function CategoryBreakdownChart({
  segments,
  centerLabel = 'Total',
  loading = false,
  emptyMessage = 'No data available',
}: CategoryBreakdownChartProps) {
  const total = segments.reduce((sum, s) => sum + (s.value || 0), 0)

  const chartData = useMemo(() => {
    if (total === 0) return []

    const data = segments
      .filter((s) => s.value > 0)
      .map((s) => ({ ...s, percentage: (s.value / total) * 100 }))

    // Calculate SVG arc segments (donut)
    let currentAngle = -90 // Start from top
    return data.map((item) => {
      const angle = (item.percentage / 100) * 360
      const startAngle = currentAngle
      const endAngle = currentAngle + angle
      currentAngle = endAngle

      const startRad = (startAngle * Math.PI) / 180
      const endRad = (endAngle * Math.PI) / 180

      const radius = 40
      const innerRadius = 25
      const cx = 50
      const cy = 50

      const x1 = cx + radius * Math.cos(startRad)
      const y1 = cy + radius * Math.sin(startRad)
      const x2 = cx + radius * Math.cos(endRad)
      const y2 = cy + radius * Math.sin(endRad)
      const x3 = cx + innerRadius * Math.cos(endRad)
      const y3 = cy + innerRadius * Math.sin(endRad)
      const x4 = cx + innerRadius * Math.cos(startRad)
      const y4 = cy + innerRadius * Math.sin(startRad)

      const largeArcFlag = angle > 180 ? 1 : 0

      const path = [
        `M ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4}`,
        'Z',
      ].join(' ')

      return { ...item, path }
    })
  }, [segments, total])

  if (loading) {
    return (
      <div className="flex items-center gap-6">
        <div className="w-32 h-32 bg-gray-100 rounded-full animate-pulse" />
        <div className="space-y-3 flex-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2 animate-pulse">
              <div className="w-3 h-3 bg-gray-200 rounded-full" />
              <div className="flex-1 h-4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-8">
      {/* Donut Chart */}
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {chartData.map((segment, index) => (
            <path
              key={index}
              d={segment.path}
              fill={segment.color}
              className="transition-opacity hover:opacity-80"
            />
          ))}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900">{total.toLocaleString()}</div>
            <div className="text-xs text-gray-500">{centerLabel}</div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-3 flex-1">
        {chartData.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <div className="flex-1 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
              <div className="text-right">
                <span className="text-sm font-semibold text-gray-900">
                  {item.value.toLocaleString()}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  ({Math.round(item.percentage)}%)
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
