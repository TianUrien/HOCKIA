/**
 * AdminMemberBlocks — members that other members blocked (founder 2026-11-09).
 * Most-blocked first, with their reports and spam signals, so an account many
 * people block stands out. The list shows counts only. "See who blocked"
 * (founder 2026-11-23) opens the members who blocked one account; the server
 * writes every such view to the admin audit log. Each row links to the member
 * in the User Directory and offers the existing admin block action.
 * Data: admin_get_member_blocks / admin_get_member_blockers / blockUser.
 *
 * Below it (founder 2026-11-10): accounts that are not blocked but used the
 * same device or network as an account an admin blocked — someone coming
 * back with a new email. A list to review; nothing is blocked automatically.
 * Data: admin_get_ban_evasion_suspects.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Eye, RefreshCw, UserX, X } from 'lucide-react'
import { ConfirmDialog, DataTable } from '../components'
import type { Action, Column } from '../components'
import { blockUser, getBanEvasionSuspects, getMemberBlockers, getMemberBlocks } from '../api/adminApi'
import type { BanEvasionSuspect, MemberBlockerRow, MemberBlockRow } from '../api/adminApi'
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
  const [confirm, setConfirm] = useState<{ profile_id: string; full_name: string | null; reason: string } | null>(null)
  const [who, setWho] = useState<{ profile_id: string; full_name: string | null; loading: boolean; rows: MemberBlockerRow[]; error: string | null } | null>(null)
  const [suspects, setSuspects] = useState<BanEvasionSuspect[]>([])
  const [suspectsLoading, setSuspectsLoading] = useState(true)

  const fetchSuspects = useCallback(async () => {
    setSuspectsLoading(true)
    try {
      setSuspects(await getBanEvasionSuspects())
    } catch (err) {
      logger.error('[AdminMemberBlocks] related accounts fetch failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load related accounts')
    } finally {
      setSuspectsLoading(false)
    }
  }, [])

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
  useEffect(() => { void fetchSuspects() }, [fetchSuspects])

  // Asked only when an admin opens it: the server logs every view.
  const openWho = async (row: MemberBlockRow) => {
    setWho({ profile_id: row.profile_id, full_name: row.full_name, loading: true, rows: [], error: null })
    try {
      const blockers = await getMemberBlockers(row.profile_id)
      setWho((w) => (w && w.profile_id === row.profile_id ? { ...w, loading: false, rows: blockers } : w))
    } catch (err) {
      logger.error('[AdminMemberBlocks] who blocked fetch failed', err)
      setWho((w) => (w && w.profile_id === row.profile_id ? { ...w, loading: false, error: err instanceof Error ? err.message : 'Failed to load who blocked this member' } : w))
    }
  }

  const handleBlock = async () => {
    if (!confirm) return
    try {
      await blockUser(confirm.profile_id, confirm.reason)
      await Promise.all([fetchBlocks(), fetchSuspects()])
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
      label: 'See who blocked',
      icon: <Eye className="h-4 w-4" />,
      onClick: (row) => { void openWho(row) },
    },
    {
      label: 'Block user',
      icon: <Ban className="h-4 w-4" />,
      variant: 'danger',
      disabled: (row) => row.is_blocked,
      onClick: (row) => setConfirm({ profile_id: row.profile_id, full_name: row.full_name, reason: `Blocked by ${members(row.block_count)}` }),
    },
  ]

  const suspectColumns: Column<BanEvasionSuspect>[] = [
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
            {row.created_after_block && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Joined after the block</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'match',
      label: 'Shares',
      render: (_, row) => (
        <span className="font-medium text-gray-900" data-testid={`match-${row.profile_id}`}>
          {row.match === 'device' ? 'Same device' : 'Same network'}
        </span>
      ),
    },
    {
      key: 'blocked_full_name',
      label: 'With blocked account',
      render: (_, row) => (
        <div>
          <Link to={`/admin/directory?profile=${row.blocked_profile_id}`} className="text-purple-700 hover:underline">
            {row.blocked_full_name || 'No name'}
          </Link>
          {row.blocked_at && <div className="text-xs text-gray-500">blocked {formatAdminDate(row.blocked_at)}</div>}
        </div>
      ),
    },
    {
      key: 'last_seen',
      label: 'Last seen there',
      render: (_, row) => <span className="whitespace-nowrap">{formatAdminDateTime(row.last_seen)}</span>,
    },
  ]

  const suspectActions: Action<BanEvasionSuspect>[] = [
    {
      label: 'Block user',
      icon: <Ban className="h-4 w-4" />,
      variant: 'danger',
      onClick: (row) => setConfirm({
        profile_id: row.profile_id,
        full_name: row.full_name,
        reason: `Same ${row.match} as blocked account ${row.blocked_full_name || row.blocked_profile_id}`,
      }),
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
            Accounts other members have blocked, most-blocked first. Open “See who blocked” on a row to see the members; each view is logged, and only admins can see it. Nothing is blocked automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void fetchBlocks(); void fetchSuspects() }}
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

      <section className="space-y-3" aria-labelledby="related-accounts-title">
        <div>
          <h2 id="related-accounts-title" className="text-lg font-semibold text-gray-900">Possibly the same person as a blocked account</h2>
          <p className="mt-1 text-sm text-gray-500">
            Accounts that are not blocked but used the same device or network as an account you blocked. Same device is a strong sign; same network is weak (clubs, families and mobile carriers share one). Nothing is blocked automatically.
          </p>
        </div>
        <DataTable
          data={suspects}
          columns={suspectColumns}
          actions={suspectActions}
          keyField="profile_id"
          loading={suspectsLoading}
          emptyMessage="No account shares a device or network with a blocked account."
        />
      </section>

      {who && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWho(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="who-blocked-title"
            data-testid="who-blocked-dialog"
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
              <div>
                <h2 id="who-blocked-title" className="text-lg font-semibold text-gray-900">Who blocked {who.full_name || 'this account'}</h2>
                <p className="mt-0.5 text-sm text-gray-500">Admins only. This view was logged.</p>
              </div>
              <button type="button" onClick={() => setWho(null)} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {who.loading && <p className="text-sm text-gray-500">Loading…</p>}
              {who.error && <p className="text-sm text-red-700">{who.error}</p>}
              {!who.loading && !who.error && who.rows.length === 0 && <p className="text-sm text-gray-500">No member blocks this account now.</p>}
              <ul className="divide-y divide-gray-100">
                {who.rows.map((b) => (
                  <li key={b.profile_id} className="flex items-center justify-between gap-3 py-3" data-testid={`blocker-${b.profile_id}`}>
                    <div className="min-w-0">
                      <Link to={`/admin/directory?profile=${b.profile_id}`} className="font-medium text-purple-700 hover:underline">
                        {b.full_name || 'No name'}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        {b.role && <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${getRoleBadgeClasses(b.role)}`}>{b.role}</span>}
                        {b.is_blocked && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">Blocked by admin</span>}
                      </div>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-sm text-gray-600">{formatAdminDateTime(b.blocked_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

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
