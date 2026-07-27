/**
 * UserGrowthChart Component
 *
 * Displays cumulative user signup trends over time as an area chart.
 */

import { useMemo, useState } from 'react'
import { formatAdminDate, formatAdminDateShort } from '../utils/formatDate'
import type { InvestorSignupTrend } from '../types'

interface UserGrowthChartProps {
  trends: InvestorSignupTrend[] | null
  loading?: boolean
}

export function UserGrowthChart({ trends, loading = false }: UserGrowthChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const chartData = useMemo(() => {
    if (!trends || trends.length === 0) return null

    const maxValue = Math.max(...trends.map((t) => t.cumulative_total))
    const minValue = Math.min(...trends.map((t) => t.cumulative_total))
    const range = maxValue - minValue || 1

    return {
      points: trends.map((trend, index) => ({
        ...trend,
        x: (index / (trends.length - 1)) * 100,
        y: 100 - ((trend.cumulative_total - minValue) / range) * 100,
      })),
      maxValue,
      minValue,
    }
  }, [trends])

  if (loading) {
    return (
      <div className="h-64 animate-pulse">
        <div className="w-full h-full bg-gray-100 rounded-lg" />
      </div>
    )
  }

  if (!chartData || chartData.points.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No signup data available
      </div>
    )
  }

  // Generate SVG path for the area chart
  const generatePath = () => {
    const points = chartData.points
    if (points.length === 0) return ''

    // Start from bottom left
    let path = `M 0 100`

    // Line to first point
    path += ` L ${points[0].x} ${points[0].y}`

    // Draw line through all points
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`
    }

    // Close the path back to bottom
    path += ` L 100 100 Z`

    return path
  }

  // Generate line path (for the stroke)
  const generateLinePath = () => {
    const points = chartData.points
    if (points.length === 0) return ''

    let path = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`
    }
    return path
  }

  const hoveredPoint = hoveredIndex !== null ? chartData.points[hoveredIndex] : null

  return (
    <div className="relative">
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-xs text-gray-500">
        <span>{chartData.maxValue.toLocaleString()}</span>
        <span>{Math.round((chartData.maxValue + chartData.minValue) / 2).toLocaleString()}</span>
        <span>{chartData.minValue.toLocaleString()}</span>
      </div>

      {/* Chart area */}
      <div className="ml-14 h-64 relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-full"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Grid lines */}
          <line x1="0" y1="25" x2="100" y2="25" stroke="#e5e7eb" strokeWidth="0.5" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="#e5e7eb" strokeWidth="0.5" />
          <line x1="0" y1="75" x2="100" y2="75" stroke="#e5e7eb" strokeWidth="0.5" />

          {/* Gradient definition */}
          <defs>
            <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Area fill */}
          <path d={generatePath()} fill="url(#areaGradient)" />

          {/* Line stroke */}
          <path
            d={generateLinePath()}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hover detection areas */}
          {chartData.points.map((point, index) => (
            <rect
              key={index}
              x={point.x - 100 / chartData.points.length / 2}
              y="0"
              width={100 / chartData.points.length}
              height="100"
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(index)}
            />
          ))}

          {/* Hover indicator */}
          {hoveredPoint && (
            <>
              <line
                x1={hoveredPoint.x}
                y1="0"
                x2={hoveredPoint.x}
                y2="100"
                stroke="#8b5cf6"
                strokeWidth="1"
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="4"
                fill="#8b5cf6"
                stroke="white"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Tooltip */}
        {hoveredPoint && (
          <div
            className="absolute bg-gray-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg z-10"
            style={{
              left: `${hoveredPoint.x}%`,
              top: `${hoveredPoint.y}%`,
              transform: 'translate(-50%, -120%)',
            }}
          >
            <div className="font-medium">{formatAdminDate(hoveredPoint.date)}</div>
            <div className="text-gray-500">
              {hoveredPoint.cumulative_total.toLocaleString()} total users
            </div>
            <div className="text-gray-400 text-[10px]">
              +{hoveredPoint.total_signups} on this day
            </div>
          </div>
        )}
      </div>

      {/* X-axis labels */}
      <div className="ml-14 flex justify-between text-xs text-gray-500 mt-2">
        <span>{trends && trends.length > 0 ? formatAdminDateShort(trends[0].date) : ''}</span>
        <span>{trends && trends.length > 0 ? formatAdminDateShort(trends[Math.floor(trends.length / 2)].date) : ''}</span>
        <span>{trends && trends.length > 0 ? formatAdminDateShort(trends[trends.length - 1].date) : ''}</span>
      </div>
    </div>
  )
}
