/**
 * AdminReports Page
 *
 * Review and manage user-submitted content reports.
 * Required for Apple Guideline 1.2 compliance.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDateTime } from '../utils/formatDate'
import {
  RefreshCw,
  AlertTriangle,
  Flag,
  CheckCircle,
  XCircle,
  Eye,
  User,
  MessageSquare,
  FileText,
  Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25

interface Report {
  id: string
  reporter_id: string
  reporter_name: string | null
  reporter_avatar: string | null
  target_id: string
  target_name: string | null
  target_avatar: string | null
  target_role: string | null
  content_type: string | null
  content_id: string | null
  reason: string
  category: string
  status: string
  reviewed_by: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  created_at: string
  total_count: number
}

const CATEGORY_LABELS: Record<string, string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  inappropriate_content: 'Inappropriate Content',
  impersonation: 'Impersonation',
  hate_speech: 'Hate Speech',
  violence: 'Violence',
  misinformation: 'Misinformation',
  other: 'Other',
}

const CATEGORY_COLORS: Record<string, string> = {
  harassment: 'bg-red-100 text-red-700',
  spam: 'bg-yellow-100 text-yellow-700',
  inappropriate_content: 'bg-orange-100 text-orange-700',
  impersonation: 'bg-purple-100 text-purple-700',
  hate_speech: 'bg-red-100 text-red-800',
  violence: 'bg-red-100 text-red-700',
  misinformation: 'bg-blue-100 text-blue-700',
  other: 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  reviewed: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-600',
}

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  user: <User className="w-3.5 h-3.5" />,
  post: <FileText className="w-3.5 h-3.5" />,
  comment: <MessageSquare className="w-3.5 h-3.5" />,
}

export function AdminReports() {
  const [reports, setReports] = useState<Report[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [categoryFilter, setCategoryFilter] = useState<string>('')

  const fetchReports = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcError } = await (supabase as any).rpc('admin_get_reports', {
        p_status: statusFilter || null,
        p_category: categoryFilter || null,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      })

      if (rpcError) throw rpcError

      const rows = (data || []) as Report[]
      setReports(rows)
      setTotalCount(rows[0]?.total_count ?? 0)
    } catch (err) {
      logger.error('[AdminReports] Failed to fetch reports:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch reports')
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter, categoryFilter, page])

  useEffect(() => {
    document.title = 'Content Reports | HOCKIA Admin'
    fetchReports()
  }, [fetchReports])

  const handleResolve = async (reportId: string, newStatus: string) => {
    setActionLoading(reportId)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcError } = await (supabase as any).rpc('admin_resolve_report', {
        p_report_id: reportId,
        p_new_status: newStatus,
      })
      if (rpcError) throw rpcError
      await fetchReports()
    } catch (err) {
      logger.error('[AdminReports] Failed to resolve report:', err)
      setError(err instanceof Error ? err.message : 'Failed to update report')
    } finally {
      setActionLoading(null)
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const pendingCount = statusFilter === 'pending' ? totalCount : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and act on user-submitted reports
            {pendingCount !== null && pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                {pendingCount} pending
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchReports}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          aria-label="Filter by status"
          title="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          aria-label="Filter by category"
          title="Filter by category"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Error loading reports</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Reports list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="animate-pulse p-4 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-8 h-8 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-gray-200 rounded" />
                  <div className="h-3 w-32 bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center">
            <Flag className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No reports found</p>
            <p className="text-sm text-gray-400 mt-1">
              {statusFilter === 'pending' ? 'All clear — no pending reports' : 'Try changing the filters'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {reports.map((report) => (
              <div key={report.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Reporter avatar */}
                  <div className="flex-shrink-0">
                    {report.reporter_avatar ? (
                      <img src={report.reporter_avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                        <User className="w-4 h-4 text-gray-500" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Top row: reporter → target */}
                    <div className="flex items-center gap-1.5 flex-wrap text-sm">
                      <span className="font-medium text-gray-900">
                        {report.reporter_name || 'Unknown'}
                      </span>
                      <span className="text-gray-400">reported</span>
                      <span className="font-medium text-gray-900">
                        {report.target_name || 'Unknown'}
                      </span>
                      {report.target_role && (
                        <span className="text-xs text-gray-400">({report.target_role})</span>
                      )}
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {/* Content type */}
                      {report.content_type && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          {CONTENT_TYPE_ICONS[report.content_type]}
                          {report.content_type}
                        </span>
                      )}
                      {/* Category */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[report.category] || CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[report.category] || report.category}
                      </span>
                      {/* Status */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[report.status] || STATUS_COLORS.pending}`}>
                        {STATUS_LABELS[report.status] || report.status}
                      </span>
                      {/* Time */}
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="w-3 h-3" />
                        {formatAdminDateTime(report.created_at)}
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="mt-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                      {report.reason}
                    </p>

                    {/* Reviewer info */}
                    {report.reviewed_at && (
                      <p className="mt-1.5 text-xs text-gray-400">
                        Reviewed by {report.reviewer_name || 'admin'} on {formatAdminDateTime(report.reviewed_at)}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  {report.status === 'pending' && (
                    <div className="flex-shrink-0 flex flex-col gap-1.5">
                      <button
                        onClick={() => handleResolve(report.id, 'resolved')}
                        disabled={actionLoading === report.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors"
                        title="Mark as resolved"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Resolve
                      </button>
                      <button
                        onClick={() => handleResolve(report.id, 'reviewed')}
                        disabled={actionLoading === report.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                        title="Mark as reviewed"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Review
                      </button>
                      <button
                        onClick={() => handleResolve(report.id, 'dismissed')}
                        disabled={actionLoading === report.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
                        title="Dismiss report"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1} to{' '}
              {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} reports
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
