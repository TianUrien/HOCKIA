/**
 * AdminOutreach Page
 *
 * Manages external outreach contacts for email campaigns.
 * Features: funnel stats, filtered contact table, CSV import.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Upload,
  Users,
  Mail,
  Eye,
  MousePointerClick,
  UserCheck,
  UserPlus,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { OutreachImportModal } from '../components/OutreachImportModal'
import { AddContactModal } from '../components/AddContactModal'
import { getOutreachContacts, getOutreachStats } from '../api/outreachApi'
import type { OutreachContact, OutreachStats, OutreachContactFilters } from '../types'
import { logger } from '@/lib/logger'

const STATUS_BADGES: Record<string, string> = {
  imported: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-100 text-blue-700',
  delivered: 'bg-indigo-100 text-indigo-700',
  opened: 'bg-purple-100 text-purple-700',
  clicked: 'bg-amber-100 text-amber-700',
  signed_up: 'bg-green-100 text-green-700',
  bounced: 'bg-red-100 text-red-700',
  unsubscribed: 'bg-gray-200 text-gray-600',
}

const PAGE_SIZE = 50

export function AdminOutreach() {
  const [stats, setStats] = useState<OutreachStats | null>(null)
  const [contacts, setContacts] = useState<OutreachContact[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isStatsLoading, setIsStatsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [page, setPage] = useState(0)

  // Modals
  const [showImport, setShowImport] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchStats = useCallback(async () => {
    setIsStatsLoading(true)
    try {
      const data = await getOutreachStats()
      setStats(data)
    } catch (err) {
      logger.error('[AdminOutreach] Failed to load stats:', err)
    } finally {
      setIsStatsLoading(false)
    }
  }, [])

  const fetchContacts = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const filters: OutreachContactFilters = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }
      if (filterStatus) filters.status = filterStatus
      if (filterCountry) filters.country = filterCountry
      if (debouncedSearch) filters.search = debouncedSearch

      const result = await getOutreachContacts(filters)
      setContacts(result.contacts)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[AdminOutreach] Failed to load contacts:', err)
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setIsLoading(false)
    }
  }, [page, filterStatus, filterCountry, debouncedSearch])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchContacts() }, [fetchContacts])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [filterStatus, filterCountry, debouncedSearch])

  const handleImportComplete = () => {
    setShowImport(false)
    fetchStats()
    fetchContacts()
  }

  const handleAddComplete = () => {
    setShowAddContact(false)
    fetchStats()
    fetchContacts()
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outreach</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage external contacts for outbound email campaigns
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchStats(); fetchContacts() }}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowAddContact(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Contact
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label="Total Contacts"
          value={stats?.total ?? 0}
          icon={Users}
          color="purple"
          loading={isStatsLoading}
        />
        <StatCard
          label="Imported"
          value={stats?.imported ?? 0}
          icon={Upload}
          color="gray"
          loading={isStatsLoading}
        />
        <StatCard
          label="Contacted"
          value={stats?.contacted ?? 0}
          icon={Mail}
          color="blue"
          loading={isStatsLoading}
        />
        <StatCard
          label="Opened"
          value={stats?.opened ?? 0}
          icon={Eye}
          color="purple"
          loading={isStatsLoading}
        />
        <StatCard
          label="Clicked"
          value={stats?.clicked ?? 0}
          icon={MousePointerClick}
          color="amber"
          loading={isStatsLoading}
        />
        <StatCard
          label="Signed Up"
          value={stats?.signed_up ?? 0}
          icon={UserCheck}
          color="green"
          loading={isStatsLoading}
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search by email, name, or club..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            autoComplete="off"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All statuses</option>
            <option value="imported">Imported</option>
            <option value="contacted">Contacted</option>
            <option value="delivered">Delivered</option>
            <option value="opened">Opened</option>
            <option value="clicked">Clicked</option>
            <option value="signed_up">Signed Up</option>
            <option value="bounced">Bounced</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
          <input
            type="text"
            placeholder="Filter by country..."
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="w-40 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Contacts table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Club</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Country</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Last Contacted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Loading contacts...</p>
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">
                      {debouncedSearch || filterStatus || filterCountry
                        ? 'No contacts match your filters'
                        : 'No contacts imported yet. Click "Import CSV" to get started.'}
                    </p>
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">
                        {contact.contact_name || '—'}
                      </span>
                      {contact.role_at_club && (
                        <span className="text-xs text-gray-400 ml-2">{contact.role_at_club}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{contact.club_name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{contact.email}</td>
                    <td className="px-4 py-3 text-gray-500">{contact.country || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_BADGES[contact.status] || 'bg-gray-100 text-gray-600'}`}>
                        {contact.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {contact.last_contacted_at
                        ? new Date(contact.last_contacted_at).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <OutreachImportModal
          onClose={() => setShowImport(false)}
          onImported={handleImportComplete}
        />
      )}

      {/* Add Contact Modal */}
      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onAdded={handleAddComplete}
        />
      )}
    </div>
  )
}

export default AdminOutreach
