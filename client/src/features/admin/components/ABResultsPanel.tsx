import { useState, useEffect } from 'react'
import { X, Trophy, Loader2 } from 'lucide-react'
import type { EmailCampaign, CampaignVariantMetrics } from '../types'
import { getCampaignVariantMetrics } from '../api/adminApi'

interface ABResultsPanelProps {
  campaign: EmailCampaign
  onClose: () => void
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function getWinner(metrics: CampaignVariantMetrics[]): 'A' | 'B' | 'tie' | null {
  const a = metrics.find(m => m.variant === 'A')
  const b = metrics.find(m => m.variant === 'B')
  if (!a || !b || a.total === 0 || b.total === 0) return null

  const openRateA = a.opened / a.total
  const openRateB = b.opened / b.total
  if (openRateA > openRateB) return 'A'
  if (openRateB > openRateA) return 'B'

  const clickRateA = a.clicked / a.total
  const clickRateB = b.clicked / b.total
  if (clickRateA > clickRateB) return 'A'
  if (clickRateB > clickRateA) return 'B'

  return 'tie'
}

export function ABResultsPanel({ campaign, onClose }: ABResultsPanelProps) {
  const [metrics, setMetrics] = useState<CampaignVariantMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    getCampaignVariantMetrics(campaign.id)
      .then(setMetrics)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [campaign.id])

  const winner = getWinner(metrics)
  const variantA = metrics.find(m => m.variant === 'A')
  const variantB = metrics.find(m => m.variant === 'B')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">A/B Test Results</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">{campaign.name}</p>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading results...
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 py-4">{error}</p>
        ) : !variantA && !variantB ? (
          <p className="text-sm text-gray-500 py-4">No variant data available yet. Send the campaign first.</p>
        ) : (
          <>
            {/* Subject lines */}
            {campaign.ab_variants && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">Variant A</p>
                  {campaign.ab_variants.A.template_key && (
                    <p className="text-xs text-blue-500 mb-0.5">Template: {campaign.ab_variants.A.template_key}</p>
                  )}
                  <p className="text-sm text-blue-900">{campaign.ab_variants.A.subject}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-amber-600 mb-1">Variant B</p>
                  {campaign.ab_variants.B.template_key && (
                    <p className="text-xs text-amber-500 mb-0.5">Template: {campaign.ab_variants.B.template_key}</p>
                  )}
                  <p className="text-sm text-amber-900">{campaign.ab_variants.B.subject}</p>
                </div>
              </div>
            )}

            {/* Metrics table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Metric</th>
                    <th className="text-center px-4 py-2 text-blue-700 font-medium">Variant A</th>
                    <th className="text-center px-4 py-2 text-amber-700 font-medium">Variant B</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-2.5 text-gray-700">Sent</td>
                    <td className="px-4 py-2.5 text-center font-medium">{variantA?.total ?? 0}</td>
                    <td className="px-4 py-2.5 text-center font-medium">{variantB?.total ?? 0}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-2.5 text-gray-700">Delivered</td>
                    <td className="px-4 py-2.5 text-center">{variantA?.delivered ?? 0} ({pct(variantA?.delivered ?? 0, variantA?.total ?? 0)})</td>
                    <td className="px-4 py-2.5 text-center">{variantB?.delivered ?? 0} ({pct(variantB?.delivered ?? 0, variantB?.total ?? 0)})</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-2.5 text-gray-700 font-medium">Opened</td>
                    <td className={`px-4 py-2.5 text-center font-medium ${winner === 'A' ? 'text-green-700 bg-green-50' : ''}`}>
                      {variantA?.opened ?? 0} ({pct(variantA?.opened ?? 0, variantA?.total ?? 0)})
                      {winner === 'A' && <Trophy className="w-3.5 h-3.5 inline ml-1 text-green-600" />}
                    </td>
                    <td className={`px-4 py-2.5 text-center font-medium ${winner === 'B' ? 'text-green-700 bg-green-50' : ''}`}>
                      {variantB?.opened ?? 0} ({pct(variantB?.opened ?? 0, variantB?.total ?? 0)})
                      {winner === 'B' && <Trophy className="w-3.5 h-3.5 inline ml-1 text-green-600" />}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-gray-700">Clicked</td>
                    <td className="px-4 py-2.5 text-center">{variantA?.clicked ?? 0} ({pct(variantA?.clicked ?? 0, variantA?.total ?? 0)})</td>
                    <td className="px-4 py-2.5 text-center">{variantB?.clicked ?? 0} ({pct(variantB?.clicked ?? 0, variantB?.total ?? 0)})</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Winner banner */}
            {winner && winner !== 'tie' && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-green-600" />
                <p className="text-sm text-green-800 font-medium">
                  Variant {winner} wins with a higher open rate
                </p>
              </div>
            )}
            {winner === 'tie' && (
              <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-600">Both variants performed equally.</p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
