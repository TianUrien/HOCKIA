/**
 * AdminMemberBlocks — members that other members blocked (founder 2026-11-09).
 * Most-blocked first, with their reports and spam signals, so an account many
 * people block stands out. Who blocked them is never shown: a block is a
 * private safety action. Each row links to the member in the User Directory
 * and offers the existing admin block action.
 * Data: admin_get_member_blocks / blockUser.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, RefreshCw, UserX } from 'lucide-react'
import { ConfirmDialog, DataTable } from '../components'
import type { Action, Column } from '../components'
import { blockUser, getMemberBlocks } from '../api/adminApi'
import type { MemberBlockRow } from '../api/adminApi'
import { formatAdminDate, formatAdminDateTime } from '../utils/formatDate'
import { getRoleBadgeClasses } from '@/lib/roleColors'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 50
const members = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`

export function AdminMemberBlocks() {
  const [rows, setRows] = useState<MemberBlockRow[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<MemberBlockRow | null>(null)

  const fetchBlocks = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getMemberBlocks({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      setRows(result.rows)
      setTotal(result.total)
    } catch (err) {
      logger.error('[AdminMemberBlocks] fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load member blocks')
    } finally {
      setIsLoading(false)
    }
  }, [page])

  useEffect(() => { document.title = 'Member blocks | Hockia Admin' }, [])
  useEffect(() => { void fetchBlocks() }, [fetchBlocks])

  const handleBlock = async () => {
    if (!confirm) return
    try {
      await blockUser(confirm.profile_id, `Blocked by ${members(confirm.block_count)}`)
      await fetchBlocks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block this account')
      throw err
    }
  }

  const columns: Column<MemberBlockRow>[] = [
    {
      key: 'full_name',
      label: 'Who',
      render: (_, row) => (
        <div className="min-w-[180px]">
          <Link to={`/admin/directory?profile=${row.profile_id}`} className="font-medium text-purple-700 hover:underline">
            {row.full_name || 'No name'}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            {row.role && <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${getRoleBadgeClasses(row.role)}`}>{row.role}</span>}
            <span>Joined {formatAdminDate(row.account_created_at)}</span>
            {row.is_blocked && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">Blocked by admin</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'block_count',
      label: 'Blocked by',
      render: (_, row) => <span className="font-medium text-gray-900" data-testid={`blocks-${row.profile_id}`}>{members(row.block_count)}</span>,
    },
    {
      key: 'last_blocked_at',
      label: 'When',
      render: (_, row) => (
        <div className="whitespace-nowrap">
          <div>{formatAdminDateTime(row.last_blocked_at)}</div>
          {row.first_blocked_at !== row.last_blocked_at && (
            <div className="text-xs text-gray-500">first {formatAdminDateTime(row.first_blocked_at)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'report_count',
      label: 'Reports',
      render: (_, row) => (row.report_count > 0
        ? <Link to="/admin/reports" className="text-purple-700 hover:underline">{row.report_count}</Link>
        : <span className="text-gray-400">0</span>),
    },
    {
      key: 'signal_count',
      label: 'Spam signals',
      render: (_, row) => (row.signal_count > 0
        ? <Link to="/admin/spam-signals" className="text-purple-700 hover:underline">{row.signal_count}</Link>
        : <span className="text-gray-400">0</span>),
    },
  ]

  const actions: Action<MemberBlockRow>[] = [
    {
      label: 'Block user',
      icon: <Ban className="h-4 w-4" />,
      variant: 'danger',
      disabled: (row) => row.is_blocked,
      onClick: (row) => setConfirm(row),
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <UserX className="h-6 w-6 text-gray-500" />
            Member blocks
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Accounts other members have blocked, most-blocked first. Who blocked them is never shown. Nothing is blocked automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchBlocks()}
          disabled={isLoading}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}

      <DataTable
        data={rows}
        columns={columns}
        actions={actions}
        keyField="profile_id"
        loading={isLoading}
        emptyMessage="No member has blocked anyone yet."
        pagination={total > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, totalCount: total, onPageChange: setPage } : undefined}
      />

      <ConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={handleBlock}
        title="Block User"
        message={`Are you sure you want to block "${confirm?.full_name || 'this account'}"? They will not be able to access the platform.`}
        confirmLabel="Block User"
        variant="danger"
      />
    </div>
  )
}
