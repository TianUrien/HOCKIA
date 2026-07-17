/**
 * AdminWorldClaims — post-hoc review queue for world-club ownership claims
 * (World Phase 1).
 *
 * Zero-friction growth phase: claims are granted instantly (review mode
 * 'auto') and every grant lands here as an audit row. Tian reviews after the
 * fact: mark a claim reviewed, or revoke it (unclaims the club and clears the
 * claimant's profile link). Unreviewed rows are highlighted. If the review
 * mode is ever flipped to 'manual', pending requests surface in this same
 * queue with no code change.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Check,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { ConfirmDialog } from './ConfirmDialog'
import { getWorldClubClaims, markClaimReviewed, revokeWorldClubClaim } from '../api/adminApi'
import type { WorldClubClaim, WorldClubClaimFilters } from '../types'

const PAGE_SIZE = 25

const STATUS_BADGE: Record<WorldClubClaim['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  auto_approved: 'bg-green-100 text-green-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  revoked: 'bg-red-100 text-red-700',
}

const ACTION_LABEL: Record<WorldClubClaim['action'], string> = {
  claimed_existing: 'Claimed existing',
  created_and_claimed: 'Created + claimed',
  legacy_backfill: 'Legacy (pre-audit)',
  admin_force_claim: 'Admin force-claim',
}

export function AdminWorldClaims() {
  const [claims, setClaims] = useState<WorldClubClaim[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const [statusFilter, setStatusFilter] = useState<WorldClubClaim['status'] | ''>('')
  const [unreviewedOnly, setUnreviewedOnly] = useState(false)

  const [actingOn, setActingOn] = useState<string | null>(null)
  const [claimToRevoke, setClaimToRevoke] = useState<WorldClubClaim | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)

  const fetchClaims = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters: WorldClubClaimFilters = {}
      if (statusFilter) filters.status = statusFilter
      if (unreviewedOnly) filters.unreviewed_only = true
      const result = await getWorldClubClaims(filters, PAGE_SIZE, page * PAGE_SIZE)
      setClaims(result.claims)
      setTotalCount(result.totalCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, unreviewedOnly, page])

  useEffect(() => {
    void fetchClaims()
  }, [fetchClaims])

  const handleMarkReviewed = async (claim: WorldClubClaim) => {
    setActingOn(claim.id)
    try {
      await markClaimReviewed(claim.id)
      await fetchClaims()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark reviewed')
    } finally {
      setActingOn(null)
    }
  }

  const handleRevokeConfirm = async () => {
    if (!claimToRevoke) return
    setIsRevoking(true)
    try {
      await revokeWorldClubClaim(claimToRevoke)
      setClaimToRevoke(null)
      await fetchClaims()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke claim')
    } finally {
      setIsRevoking(false)
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  // A claim that currently grants ownership can be revoked; already-revoked /
  // rejected / pending rows cannot.
  const isRevokable = (c: WorldClubClaim) =>
    (c.status === 'auto_approved' || c.status === 'approved') && c.club_is_claimed !== false

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="claims-status" className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            id="claims-status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as WorldClubClaim['status'] | ''); setPage(0) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="auto_approved">Auto-approved</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={unreviewedOnly}
            onChange={(e) => { setUnreviewedOnly(e.target.checked); setPage(0) }}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          Unreviewed only
        </label>
        <button
          onClick={() => void fetchClaims()}
          className="ml-auto p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
          title="Refresh claims"
          aria-label="Refresh claims"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Club</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claimant</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">How</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claimed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewed</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-purple-500 mx-auto" />
                  </td>
                </tr>
              ) : claims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                    <ClipboardCheck className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    No claims match the current filters.
                  </td>
                </tr>
              ) : (
                claims.map((claim) => (
                  <tr
                    key={claim.id}
                    className={claim.reviewed_at ? 'hover:bg-gray-50' : 'bg-amber-50/60 hover:bg-amber-50'}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{claim.club_name || '—'}</p>
                      <p className="text-xs text-gray-500">{claim.club_country_name || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      {claim.profile_id ? (
                        <a
                          href={`/admin/directory?profile=${claim.profile_id}`}
                          className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
                        >
                          <span className="truncate max-w-[140px]">
                            {claim.claimant_name || claim.profile_id.slice(0, 8)}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">deleted account</span>
                      )}
                      {claim.claimant_email && (
                        <p className="text-xs text-gray-500 truncate max-w-[180px]">{claim.claimant_email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {ACTION_LABEL[claim.action]}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[claim.status]}`}>
                        {claim.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(claim.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(claim.reviewed_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!claim.reviewed_at && (
                          <button
                            onClick={() => void handleMarkReviewed(claim)}
                            disabled={actingOn === claim.id}
                            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Mark reviewed"
                            aria-label={`Mark claim on ${claim.club_name} reviewed`}
                          >
                            {actingOn === claim.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Check className="w-4 h-4" />}
                          </button>
                        )}
                        {isRevokable(claim) && (
                          <button
                            onClick={() => setClaimToRevoke(claim)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Revoke claim"
                            aria-label={`Revoke claim on ${claim.club_name}`}
                          >
                            <Undo2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} claims
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Revoke confirm */}
      <ConfirmDialog
        isOpen={claimToRevoke !== null}
        title="Revoke Claim"
        message={
          claimToRevoke
            ? `Revoke ${claimToRevoke.claimant_name || 'this account'}'s claim on "${claimToRevoke.club_name}"? The club becomes unclaimed and the account's link to it is removed. The club's directory entry itself is kept.`
            : ''
        }
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevokeConfirm}
        onClose={() => setClaimToRevoke(null)}
        loading={isRevoking}
      />
    </div>
  )
}