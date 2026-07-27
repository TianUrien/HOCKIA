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
import { EditWorldRegionModal } from './EditWorldRegionModal'
import {
  getWorldProvincesAdmin,
  getAllCountries,
  deleteWorldProvince,
  getWorldProvinceRelationCounts,
} from '../api/adminApi'
import type {
  WorldProvinceAdmin,
  WorldProvinceFilters,
  WorldCountry,
} from '../types'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25

export function AdminWorldRegions() {
  // Data state
  const [regions, setRegions] = useState<WorldProvinceAdmin[]>([])
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [totalCount, setTotalCount] = useState(0)

  // Filter state
  const [filters, setFilters] = useState<WorldProvinceFilters>({})
  const [searchInput, setSearchInput] = useState('')

  // Pagination
  const [page, setPage] = useState(0)

  // Loading states
  const [loadingRegions, setLoadingRegions] = useState(true)
  const [loadingCountries, setLoadingCountries] = useState(true)

  // Modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState<WorldProvinceAdmin | null>(null)

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [regionToDelete, setRegionToDelete] = useState<WorldProvinceAdmin | null>(null)
  const [deleteMessage, setDeleteMessage] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[AdminWorldRegions] Failed to load countries:', err)
    } finally {
      setLoadingCountries(false)
    }
  }, [])

  const loadRegions = useCallback(async () => {
    setLoadingRegions(true)
    try {
      const { provinces: data, totalCount: count } = await getWorldProvincesAdmin(filters, PAGE_SIZE, page * PAGE_SIZE)
      setRegions(data)
      setTotalCount(count)
    } catch (err) {
      logger.error('[AdminWorldRegions] Failed to load regions:', err)
    } finally {
      setLoadingRegions(false)
    }
  }, [filters, page])

  // Load initial data
  useEffect(() => {
    loadCountries()
  }, [loadCountries])

  // Load regions when filters or page changes
  useEffect(() => {
    loadRegions()
  }, [loadRegions])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchInput || undefined }))
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleFilterChange = (key: keyof WorldProvinceFilters, value: unknown) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined,
    }))
    setPage(0)
  }

  const handleAddRegion = () => {
    setSelectedRegion(null)
    setEditModalOpen(true)
  }

  const handleEditRegion = (region: WorldProvinceAdmin) => {
    setSelectedRegion(region)
    setEditModalOpen(true)
  }

  const handleDeleteClick = async (region: WorldProvinceAdmin) => {
    // Fetch counts for the warning message
    try {
      const { leagueCount, clubCount } = await getWorldProvinceRelationCounts(region.id)
      let msg = `Are you sure you want to delete "${region.name}"?`
      if (leagueCount > 0 || clubCount > 0) {
        msg += ` This will cascade-delete ${leagueCount} league${leagueCount !== 1 ? 's' : ''}`
        msg += ` and unlink ${clubCount} club${clubCount !== 1 ? 's' : ''} from this region.`
      }
      msg += ' Type DELETE to confirm.'
      setDeleteMessage(msg)
    } catch {
      setDeleteMessage(`Are you sure you want to delete "${region.name}"? This may affect linked leagues and clubs. Type DELETE to confirm.`)
    }
    setRegionToDelete(region)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!regionToDelete) return

    setIsDeleting(true)
    try {
      await deleteWorldProvince(regionToDelete.id)
      setDeleteDialogOpen(false)
      setRegionToDelete(null)
      loadRegions()
    } catch (err) {
      logger.error('[AdminWorldRegions] Failed to delete region:', err)
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
          {totalCount} region{totalCount !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={loadRegions}
            className="p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
            aria-label="Refresh regions"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleAddRegion}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Region
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Search */}
          <div>
            <label htmlFor="region-search" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                id="region-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Region name..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Country */}
          <div>
            <label htmlFor="region-country-filter" className="block text-xs font-medium text-gray-500 mb-1">Country</label>
            <select
              id="region-country-filter"
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
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Country
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Slug
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
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
              {loadingRegions ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600" />
                    <p className="mt-2 text-sm text-gray-500">Loading regions...</p>
                  </td>
                </tr>
              ) : regions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No regions found matching your filters
                  </td>
                </tr>
              ) : (
                regions.map((region) => (
                  <tr key={region.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{region.name}</p>
                        {region.logical_id && (
                          <p className="text-xs text-gray-500">{region.logical_id}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {region.country_flag_emoji ?? ''} {region.country_name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 font-mono">{region.slug}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                      {region.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {region.display_order}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEditRegion(region)}
                          className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          title="Edit region"
                          aria-label={`Edit ${region.name}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(region)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete region"
                          aria-label={`Delete ${region.name}`}
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
        {!loadingRegions && totalCount > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-gray-600">
              Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} regions
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
      <EditWorldRegionModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSaved={loadRegions}
        region={selectedRegion}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete Region"
        message={deleteMessage}
        confirmLabel="Delete"
        confirmText="DELETE"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onClose={() => { setDeleteDialogOpen(false); setRegionToDelete(null) }}
        loading={isDeleting}
      />
    </div>
  )
}
