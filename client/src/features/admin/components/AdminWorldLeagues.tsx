import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { ConfirmDialog } from './ConfirmDialog'
import { EditWorldLeagueModal } from './EditWorldLeagueModal'
import {
  getWorldLeaguesAdmin,
  getAllCountries,
  getWorldProvinces,
  deleteWorldLeague,
} from '../api/adminApi'
import type {
  WorldLeagueAdmin,
  WorldLeagueFilters,
  WorldCountry,
  WorldProvince,
} from '../types'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25

export function AdminWorldLeagues() {
  // Data state
  const [leagues, setLeagues] = useState<WorldLeagueAdmin[]>([])
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [provinces, setProvinces] = useState<WorldProvince[]>([])
  const [totalCount, setTotalCount] = useState(0)

  // Filter state
  const [filters, setFilters] = useState<WorldLeagueFilters>({})
  const [searchInput, setSearchInput] = useState('')

  // Pagination
  const [page, setPage] = useState(0)

  // Loading states
  const [loadingLeagues, setLoadingLeagues] = useState(true)
  const [loadingCountries, setLoadingCountries] = useState(true)
  const [loadingProvinces, setLoadingProvinces] = useState(false)

  // Modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedLeague, setSelectedLeague] = useState<WorldLeagueAdmin | null>(null)

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [leagueToDelete, setLeagueToDelete] = useState<WorldLeagueAdmin | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[AdminWorldLeagues] Failed to load countries:', err)
    } finally {
      setLoadingCountries(false)
    }
  }, [])

  const loadProvinces = useCallback(async (countryId: number) => {
    setLoadingProvinces(true)
    try {
      const data = await getWorldProvinces(countryId)
      setProvinces(data)
    } catch (err) {
      logger.error('[AdminWorldLeagues] Failed to load provinces:', err)
      setProvinces([])
    } finally {
      setLoadingProvinces(false)
    }
  }, [])

  const loadLeagues = useCallback(async () => {
    setLoadingLeagues(true)
    try {
      const { leagues: data, totalCount: count } = await getWorldLeaguesAdmin(filters, PAGE_SIZE, page * PAGE_SIZE)
      setLeagues(data)
      setTotalCount(count)
    } catch (err) {
      logger.error('[AdminWorldLeagues] Failed to load leagues:', err)
    } finally {
      setLoadingLeagues(false)
    }
  }, [filters, page])

  // Load initial data
  useEffect(() => {
    loadCountries()
  }, [loadCountries])

  // Load leagues when filters or page changes
  useEffect(() => {
    loadLeagues()
  }, [loadLeagues])

  // Load provinces when country filter changes
  useEffect(() => {
    if (filters.country_id) {
      loadProvinces(filters.country_id)
    } else {
      setProvinces([])
    }
  }, [filters.country_id, loadProvinces])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchInput || undefined }))
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleFilterChange = (key: keyof WorldLeagueFilters, value: unknown) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined,
      ...(key === 'country_id' ? { province_id: undefined } : {}),
    }))
    setPage(0)
  }

  const handleAddLeague = () => {
    setSelectedLeague(null)
    setEditModalOpen(true)
  }

  const handleEditLeague = (league: WorldLeagueAdmin) => {
    setSelectedLeague(league)
    setEditModalOpen(true)
  }

  const handleDeleteClick = (league: WorldLeagueAdmin) => {
    setLeagueToDelete(league)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!leagueToDelete) return

    setIsDeleting(true)
    try {
      await deleteWorldLeague(leagueToDelete.id)
      setDeleteDialogOpen(false)
      setLeagueToDelete(null)
      loadLeagues()
    } catch (err) {
      logger.error('[AdminWorldLeagues] Failed to delete league:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {totalCount} league{totalCount !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={loadLeagues}
            className="p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
            aria-label="Refresh leagues"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleAddLeague}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add League
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label htmlFor="league-search" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                id="league-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="League name..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Country */}
          <div>
            <label htmlFor="league-country-filter" className="block text-xs font-medium text-gray-500 mb-1">Country</label>
            <select
              id="league-country-filter"
              value={filters.country_id ?? ''}
              onChange={(e) => handleFilterChange('country_id', e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={loadingCountries}
            >
              <option value="">All countries</option>
              {countries.map(c => (
                <option key={c.id} value={c.id}>
                  {c.flag_emoji} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Region */}
          <div>
            <label htmlFor="league-region-filter" className="block text-xs font-medium text-gray-500 mb-1">Region</label>
            <select
              id="league-region-filter"
              value={filters.province_id ?? ''}
              onChange={(e) => handleFilterChange('province_id', e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={!filters.country_id || loadingProvinces}
            >
              <option value="">All regions</option>
              {provinces.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  League
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Country
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loadingLeagues ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600" />
                    <p className="mt-2 text-sm text-gray-500">Loading leagues...</p>
                  </td>
                </tr>
              ) : leagues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No leagues found matching your filters
                  </td>
                </tr>
              ) : (
                leagues.map((league) => (
                  <tr key={league.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{league.name}</p>
                        {league.logical_id && (
                          <p className="text-xs text-gray-500">{league.logical_id}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {league.country_flag_emoji ?? ''} {league.country_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {league.province_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {league.tier ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          Tier {league.tier}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {league.display_order}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEditLeague(league)}
                          className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          title="Edit league"
                          aria-label={`Edit ${league.name}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(league)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete league"
                          aria-label={`Delete ${league.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loadingLeagues && totalCount > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-gray-600">
              Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} leagues
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit/Add Modal */}
      <EditWorldLeagueModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSaved={loadLeagues}
        league={selectedLeague}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete League"
        message={
          leagueToDelete
            ? `Are you sure you want to delete "${leagueToDelete.name}"? Clubs referencing this league will have their league field set to null.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onClose={() => { setDeleteDialogOpen(false); setLeagueToDelete(null) }}
        loading={isDeleting}
      />
    </div>
  )
}
