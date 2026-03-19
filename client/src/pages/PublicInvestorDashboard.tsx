/**
 * PublicInvestorDashboard Page
 *
 * Public view of the investor metrics dashboard accessed via shareable token.
 * Route: /investors/:token
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { InvestorDashboardContent } from '@/features/admin/components/InvestorDashboardContent'
import {
  getPublicInvestorMetrics,
  getPublicInvestorSignupTrends,
} from '@/features/admin/api/adminApi'
import type { InvestorMetrics, InvestorSignupTrend } from '@/features/admin/types'

export default function PublicInvestorDashboard() {
  const { token } = useParams<{ token: string }>()
  const [metrics, setMetrics] = useState<InvestorMetrics | null>(null)
  const [trends, setTrends] = useState<InvestorSignupTrend[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!token) {
      setError('Invalid link')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [metricsData, trendsData] = await Promise.all([
        getPublicInvestorMetrics(token, 90),
        getPublicInvestorSignupTrends(token, 90),
      ])
      setMetrics(metricsData)
      setTrends(trendsData)
    } catch {
      setError('This link is invalid or has expired')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Error state - invalid or expired token
  if (error && !loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Not Valid</h1>
          <p className="text-gray-500 mb-6">{error}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Go to HOCKIA
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-bold text-gray-900">HOCKIA</span>
            </Link>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 sm:px-6">
        <InvestorDashboardContent
          metrics={metrics}
          trends={trends}
          loading={loading}
          error={error}
          onRefresh={fetchData}
          showWatermark={true}
        />
      </main>
    </div>
  )
}
