/**
 * AdminSpamSignals — who used their whole daily allowance of new conversations
 * and who sent the same first message to many people. Signals only: nothing is
 * blocked automatically. Each row links to the member in the User Directory,
 * offers the existing block action, and "Send safety notice" (marks the account
 * as removed and tells everyone it had a conversation with, once).
 * Data: admin_get_spam_signals / admin_send_removed_account_notice.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, RefreshCw, Send, ShieldAlert } from 'lucide-react'
import { ConfirmDialog, DataTable } from '../components'
import type { Action, Column } from '../components'
import { blockUser, getSpamSignals, sendRemovedAccountNotice } from '../api/adminApi'
import type { SpamSignalRow } from '../api/adminApi'
import { formatAdminDate, formatAdminDateTime } from '../utils/formatDate'
import { getRoleBadgeClasses } from '@/lib/roleColors'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90
const PAGE_SIZE = 50

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

function signalLabel(row: Pick<SpamSignalRow, 'kind'>): string {
  return row.kind === 'daily_limit' ? 'Reached the daily limit' : 'Same first message to many people'
}

export function AdminSpamSignals() {
  const [rows, setRows] = useState<SpamSignalRow[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<{ type: 'block' | 'notice'; row: SpamSignalRow } | null>(null)
  /** profile id → how many people the notice just reached. */
  const [sent, setSent] = useState<Record<string, number>>({})

  const fetchSignals = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getSpamSignals({ days: daysFilter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      setRows(result.rows)
      setTotal(result.total)
    } catch (err) {
      logger.error('[AdminSpamSignals] fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load signals')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, page])

  useEffect(() => { document.title = 'Spam signals | HOCKIA Admin' }, [])
  useEffect(() => { void fetchSignals() }, [fetchSignals])

  const handleBlock = async () => {
    if (!confirm) return
    try {
      await blockUser(confirm.row.profile_id, `Spam signal: ${signalLabel(confirm.row).toLowerCase()}`)
      await fetchSignals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block this account')
      throw err
    }
  }

  const handleSendNotice = async () => {
    if (!confirm) return
    const profileId = confirm.row.profile_id
    try {
      const count = await sendRemovedAccountNotice(profileId)
      setSent((prev) => ({ ...prev, [profileId]: count }))
      await fetchSignals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the safety notice')
      throw err
    }
  }

  const columns: Column<SpamSignalRow>[] = [
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
            {row.is_blocked && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">Blocked</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      label: 'Signal',
      render: (_, row) => (
        <div className="max-w-md">
          <div className="font-medium text-gray-900">{signalLabel(row)}</div>
          {row.kind === 'repeated_first_message' && row.sample_text && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-gray-500">“{row.sample_text}”</p>
          )}
        </div>
      ),
    },
    {
      key: 'people_count',
      label: 'How many people',
      render: (_, row) => (
        <div>
          <div>{people(row.people_count)}</div>
          {row.kind === 'repeated_first_message' && row.identical_count != null && (
            <div className="text-xs text-gray-500">{row.identical_count} identical</div>
          )}
          {row.kind === 'daily_limit' && row.refusal_count > 0 && (
            <div className="text-xs text-gray-500">{row.refusal_count} refused after</div>
          )}
        </div>
      ),
    },
    {
      key: 'last_seen_at',
      label: 'When',
      render: (_, row) => (
        <div className="whitespace-nowrap">
          <div>{formatAdminDateTime(row.last_seen_at)}</div>
          {row.first_seen_at !== row.last_seen_at && (
            <div className="text-xs text-gray-500">first {formatAdminDateTime(row.first_seen_at)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'notice_sent_at',
      label: 'Safety notice',
      render: (_, row) => {
        const justSent = sent[row.profile_id]
        if (justSent !== undefined) {
          return <span className="text-gray-700" data-testid={`notice-sent-${row.id}`}>Sent to {people(justSent)}</span>
        }
        if (row.notice_sent_at) {
          return <span className="text-gray-500">Sent to {people(row.notice_count ?? 0)} · {formatAdminDate(row.notice_sent_at)}</span>
        }
        return <span className="text-gray-400">Not sent</span>
      },
    },
  ]

  const actions: Action<SpamSignalRow>[] = [
    {
      label: 'Block user',
      icon: <Ban className="h-4 w-4" />,
      variant: 'danger',
      disabled: (row) => row.is_blocked,
      onClick: (row) => setConfirm({ type: 'block', row }),
    },
    {
      label: 'Send safety notice',
      icon: <Send className="h-4 w-4" />,
      onClick: (row) => setConfirm({ type: 'notice', row }),
    },
  ]

  const name = confirm?.row.full_name || 'this account'

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ShieldAlert className="h-6 w-6 text-gray-500" />
            Spam signals
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Members who reached the daily limit for new conversations, or sent the same first message to 5 or more people in 7 days. Nothing is blocked automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={daysFilter}
            onChange={(e) => { setDaysFilter(Number(e.target.value) as DaysFilter); setPage(1) }}
            aria-label="Period"
            className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={() => void fetchSignals()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
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
        keyField="id"
        loading={isLoading}
        emptyMessage="No signals."
        pagination={total > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, totalCount: total, onPageChange: setPage } : undefined}
      />

      <ConfirmDialog
        isOpen={confirm?.type === 'block'}
        onClose={() => setConfirm(null)}
        onConfirm={handleBlock}
        title="Block User"
        message={`Are you sure you want to block "${name}"? They will not be able to access the platform.`}
        confirmLabel="Block User"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={confirm?.type === 'notice'}
        onClose={() => setConfirm(null)}
        onConfirm={handleSendNotice}
        title="Send safety notice"
        message="Send the safety notice to everyone this account messaged?"
        confirmLabel="Send safety notice"
      />
    </div>
  )
}
