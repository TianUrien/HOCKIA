/**
 * AdminAuditLog Page
 * 
 * View history of all admin actions.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDateTime } from '../utils/formatDate'
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  User,
  Ban,
  CheckCircle,
  Pencil,
  Trash2,
  Beaker,
  Shield,
} from 'lucide-react'
import type { AuditLogEntry, AuditLogSearchParams } from '../types'
import { getAuditLogs } from '../api/adminApi'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25

const ACTION_ICONS: Record<string, React.ReactNode> = {
  block_user: <Ban className="w-4 h-4 text-red-500" />,
  unblock_user: <CheckCircle className="w-4 h-4 text-green-500" />,
  update_profile: <Pencil className="w-4 h-4 text-blue-500" />,
  delete_orphan_profile: <Trash2 className="w-4 h-4 text-red-500" />,
  delete_auth_user: <Trash2 className="w-4 h-4 text-red-500" />,
  mark_test_account: <Beaker className="w-4 h-4 text-purple-500" />,
  unmark_test_account: <Beaker className="w-4 h-4 text-gray-500" />,
  grant_admin: <Shield className="w-4 h-4 text-amber-500" />,
  revoke_admin: <Shield className="w-4 h-4 text-gray-500" />,
}

const ACTION_LABELS: Record<string, string> = {
  block_user: 'Blocked User',
  unblock_user: 'Unblocked User',
  update_profile: 'Updated Profile',
  delete_orphan_profile: 'Deleted Orphan Profile',
  delete_auth_user: 'Deleted Auth User',
  mark_test_account: 'Marked as Test Account',
  unmark_test_account: 'Removed Test Flag',
  grant_admin: 'Granted Admin Access',
  revoke_admin: 'Revoked Admin Access',
}

export function AdminAuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Filters
  const [actionFilter, setActionFilter] = useState('')
  const [targetTypeFilter, setTargetTypeFilter] = useState('')

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params: AuditLogSearchParams = {
        action: actionFilter || undefined,
        target_type: targetTypeFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }

      const result = await getAuditLogs(params)
      setLogs(result.logs)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[AdminAuditLog] Failed to fetch logs:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs')
    } finally {
      setIsLoading(false)
    }
  }, [actionFilter, targetTypeFilter, page])

  useEffect(() => {
    document.title = 'Audit Log | HOCKIA Admin'
    fetchLogs()
  }, [fetchLogs])

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const uniqueActions = [...new Set(logs.map((l) => l.action))]
  const uniqueTargetTypes = [...new Set(logs.map((l) => l.target_type))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track all admin actions and changes
          </p>
        </div>
        <button
          onClick={fetchLogs}
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
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value)
            setPage(1)
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          aria-label="Filter by action"
          title="Filter by action"
        >
          <option value="">All Actions</option>
          {uniqueActions.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action] || action}
            </option>
          ))}
        </select>

        <select
          value={targetTypeFilter}
          onChange={(e) => {
            setTargetTypeFilter(e.target.value)
            setPage(1)
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          aria-label="Filter by target type"
          title="Filter by target type"
        >
          <option value="">All Target Types</option>
          {uniqueTargetTypes.map((type) => (
            <option key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Error loading audit logs</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Log entries */}
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
        ) : logs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">No audit logs found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => {
              const isExpanded = expandedRows.has(log.id)
              return (
                <div key={log.id}>
                  <button
                    onClick={() => toggleRow(log.id)}
                    className="w-full px-4 py-3 flex items-start gap-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    {/* Icon */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                      {ACTION_ICONS[log.action] || <User className="w-4 h-4 text-gray-500" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                        <span className="text-gray-400">•</span>
                        <span className="text-sm text-gray-500">
                          {log.target_type}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        by {log.admin_name || log.admin_email || 'Unknown admin'} •{' '}
                        {formatAdminDateTime(log.created_at)}
                      </div>
                    </div>

                    {/* Expand indicator */}
                    <div className="flex-shrink-0 text-gray-400">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pl-16 bg-gray-50">
                      <div className="space-y-4">
                        {/* Target ID */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Target ID
                          </p>
                          <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                            {log.target_id}
                          </code>
                        </div>

                        {/* Metadata */}
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                              Metadata
                            </p>
                            <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Before/After */}
                        <div className="grid grid-cols-2 gap-4">
                          {log.old_data && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                Before
                              </p>
                              <pre className="text-xs bg-red-50 p-2 rounded overflow-x-auto text-red-800">
                                {JSON.stringify(log.old_data, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.new_data && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                After
                              </p>
                              <pre className="text-xs bg-green-50 p-2 rounded overflow-x-auto text-green-800">
                                {JSON.stringify(log.new_data, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1} to{' '}
              {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} entries
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
