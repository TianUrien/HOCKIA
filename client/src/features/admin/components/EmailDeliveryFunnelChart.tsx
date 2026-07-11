import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

interface FunnelStep {
  label: string
  value: number
  color: string
}

interface EmailDeliveryFunnelChartProps {
  sent: number
  delivered: number
  opened: number
  clicked: number
  loading?: boolean
}

export function EmailDeliveryFunnelChart({ sent, delivered, opened, clicked, loading }: EmailDeliveryFunnelChartProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-32 flex items-center justify-center">
          <div className="animate-pulse text-gray-400 text-sm">Loading funnel...</div>
        </div>
      </div>
    )
  }

  const steps: FunnelStep[] = [
    { label: 'Sent', value: sent, color: HOCKIA_PRIMARY },
    { label: 'Delivered', value: delivered, color: '#10b981' },
    { label: 'Opened', value: opened, color: '#3b82f6' },
    { label: 'Clicked', value: clicked, color: '#f59e0b' },
  ]

  const maxValue = Math.max(sent, 1)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Delivery Funnel</h3>
      <div className="space-y-3">
        {steps.map((step, i) => {
          const widthPct = Math.max((step.value / maxValue) * 100, 2)
          const rate = i === 0 ? 100 : sent > 0 ? ((step.value / sent) * 100).toFixed(1) : 0

          return (
            <div key={step.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">{step.label}</span>
                <span className="text-sm text-gray-500">
                  {step.value.toLocaleString()} ({rate}%)
                </span>
              </div>
              <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${widthPct}%`, backgroundColor: step.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
