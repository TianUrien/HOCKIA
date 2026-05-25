/**
 * AdminInvestorDashboard Page
 *
 * Admin view of the investor metrics dashboard with shareable link management.
 * Route: /admin/investors
 */

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, PieChart } from 'lucide-react'
import { logger } from '@/lib/logger'
import { ShareLinkManager } from '../components/ShareLinkManager'
import { InvestorDashboardContent } from '../components/InvestorDashboardContent'
import {
  getInvestorMetrics,
  getInvestorSignupTrends,
  listInvestorTokens,
  createInvestorToken,
  revokeInvestorToken,
} from '../api/adminApi'
import type { InvestorMetrics, InvestorSignupTrend, InvestorShareToken } from '../types'

export function AdminInvestorDashboard() {
  const [metrics, setMetrics] = useState<InvestorMetrics | null>(null)
  const [trends, setTrends] = useState<InvestorSignupTrend[] | null>(null)
  const [tokens, setTokens] = useState<InvestorShareToken[]>([])
  const [loading, setLoading] = useState(true)
  const [tokensLoading, setTokensLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Document title — was inheriting the bare "HOCKIA – The Home of
  // Field Hockey" default, breaking the "X | HOCKIA Admin" pattern
  // used by every other admin page (QA audit 2026-05-25).
  useEffect(() => {
    document.title = 'Investors | HOCKIA Admin'
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [metricsData, trendsData] = await Promise.all([
        getInvestorMetrics(90),
        getInvestorSignupTrends(90),
      ])
      setMetrics(metricsData)
      setTrends(trendsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTokens = useCallback(async () => {
    setTokensLoading(true)
    try {
      const tokenList = await listInvestorTokens()
      setTokens(tokenList)
    } catch (err) {
      logger.error('Failed to load tokens:', err)
    } finally {
      setTokensLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetchTokens()
  }, [fetchData, fetchTokens])

  const handleCreateToken = async (name: string, expiresInDays?: number) => {
    await createInvestorToken(name, expiresInDays)
    await fetchTokens()
  }

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this link? It will no longer work.')) {
      return
    }
    await revokeInvestorToken(tokenId)
    await fetchTokens()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <PieChart className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Investor Dashboard</h1>
            <p className="text-sm text-gray-500">Metrics and shareable links for investors</p>
          </div>
        </div>
        <button
          onClick={() => {
            fetchData()
            fetchTokens()
          }}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Shareable Links Management */}
      <ShareLinkManager
        tokens={tokens}
        loading={tokensLoading}
        onCreateToken={handleCreateToken}
        onRevokeToken={handleRevokeToken}
      />

      {/* Metrics Dashboard */}
      <InvestorDashboardContent
        metrics={metrics}
        trends={trends}
        loading={loading}
        error={error}
        onRefresh={fetchData}
        showWatermark={false}
      />
    </div>
  )
}
