/**
 * AdminWorld Page
 *
 * Admin Portal page for managing Hockey World: clubs, leagues, and regions.
 * Tabbed interface with stats cards, filters, paginated tables, and CRUD modals.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Globe2,
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  UserX,
  UserPlus,
  ExternalLink,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Trophy,
  MapPin,
  Building2,
  AlertTriangle,
  Shield,
  BadgeCheck,
  ClipboardCheck,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EditWorldClubModal } from '../components/EditWorldClubModal'
import { AdminWorldLeagues } from '../components/AdminWorldLeagues'
import { AdminWorldRegions } from '../components/AdminWorldRegions'
import { AdminWorldClaims } from '../components/AdminWorldClaims'
import {
  getWorldClubs,
  getWorldClubStats,
  getAllCountries,
  getWorldProvinces,
  unclaimWorldClub,
  deleteWorldClub,
  forceClaimWorldClub,
  setWorldClubVerified,
} from '../api/adminApi'
import type {
  WorldClub,
  WorldClubStats,
  WorldClubFilters,
  WorldCountry,
  WorldProvince,
} from '../types'
import { logger } from '@/lib/logger'

const PAGE_SIZE = 25
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type WorldTab = 'clubs' | 'leagues' | 'regions' | 'claims'

export default function AdminWorld() {
  // Tab state
  const [activeTab, setActiveTab] = useState<WorldTab>('clubs')

  // Data state
  const [clubs, setClubs] = useState<WorldClub[]>([])
  const [stats, setStats] = useState<WorldClubStats | null>(null)
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [provinces, setProvinces] = useState<WorldProvince[]>([])
  const [totalCount, setTotalCount] = useState(0)

  // Filter state
  const [filters, setFilters] = useState<WorldClubFilters>({})
  const [searchInput, setSearchInput] = useState('')

  // Pagination
  const [page, setPage] = useState(0)

  // Loading states
  const [loadingClubs, setLoadingClubs] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingCountries, setLoadingCountries] = useState(true)
  const [loadingProvinces, setLoadingProvinces] = useState(false)

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedClub, setSelectedClub] = useState<WorldClub | null>(null)

  // Verified-mark toggle (in-flight club id)
  const [verifyingClubId, setVerifyingClubId] = useState<string | null>(null)

  // Unclaim confirm dialog
  const [unclaimDialogOpen, setUnclaimDialogOpen] = useState(false)
  const [clubToUnclaim, setClubToUnclaim] = useState<WorldClub | null>(null)
  const [isUnclaiming, setIsUnclaiming] = useState(false)

  // Delete confirm dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [clubToDelete, setClubToDelete] = useState<WorldClub | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Force claim dialog
  const [forceClaimOpen, setForceClaimOpen] = useState(false)
  const [clubToForceClaim, setClubToForceClaim] = useState<WorldClub | null>(null)
  const [forceClaimProfileId, setForceClaimProfileId] = useState('')
  const [isForceClaiming, setIsForceClaiming] = useState(false)
  const [forceClaimError, setForceClaimError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const data = await getWorldClubStats()
      setStats(data)
    } catch (err) {
      logger.error('[AdminWorld] Failed to load stats:', err)
    } finally {
      setLoadingStats(false)
    }
  }, [])

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true)
    try {
      const data = await getAllCountries()
      setCountries(data)
    } catch (err) {
      logger.error('[AdminWorld] Failed to load countries:', err)
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
      logger.error('[AdminWorld] Failed to load provinces:', err)
      setProvinces([])
    } finally {
      setLoadingProvinces(false)
    }
  }, [])

  const loadClubs = useCallback(async () => {
    setLoadingClubs(true)
    try {
      const { clubs: data, totalCount: count } = await getWorldClubs(filters, PAGE_SIZE, page * PAGE_SIZE)
      setClubs(data)
      setTotalCount(count)
    } catch (err) {
      logger.error('[AdminWorld] Failed to load clubs:', err)
    } finally {
      setLoadingClubs(false)
    }
  }, [filters, page])

  // Load initial data
  useEffect(() => {
    loadStats()
    loadCountries()
  }, [loadStats, loadCountries])

  // Load clubs when filters or page changes
  useEffect(() => {
    loadClubs()
  }, [loadClubs])

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

  const handleFilterChange = (key: keyof WorldClubFilters, value: unknown) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined,
      ...(key === 'country_id' ? { province_id: undefined } : {}),
    }))
    setPage(0)
  }

  const handleAddClub = () => {
    setSelectedClub(null)
    setEditModalOpen(true)
  }

  const handleEditClub = (club: WorldClub) => {
    setSelectedClub(club)
    setEditModalOpen(true)
  }

  const handleToggleVerified = async (club: WorldClub) => {
    setVerifyingClubId(club.id)
    try {
      await setWorldClubVerified(club.id, !club.verified_at)
      loadClubs()
    } catch (err) {
      logger.error('[AdminWorld] Failed to toggle verified:', err)
    } finally {
      setVerifyingClubId(null)
    }
  }

  const handleUnclaimClick = (club: WorldClub) => {
    setClubToUnclaim(club)
    setUnclaimDialogOpen(true)
  }

  const handleUnclaimConfirm = async () => {
    if (!clubToUnclaim) return

    setIsUnclaiming(true)
    try {
      await unclaimWorldClub(clubToUnclaim.id)
      setUnclaimDialogOpen(false)
      setClubToUnclaim(null)
      loadClubs()
      loadStats()
    } catch (err) {
      logger.error('[AdminWorld] Failed to unclaim:', err)
    } finally {
      setIsUnclaiming(false)
    }
  }

  // Delete handlers
  const handleDeleteClick = (club: WorldClub) => {
    setClubToDelete(club)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!clubToDelete) return

    setIsDeleting(true)
    try {
      await deleteWorldClub(clubToDelete.id)
      setDeleteDialogOpen(false)
      setClubToDelete(null)
      loadClubs()
      loadStats()
    } catch (err) {
      logger.error('[AdminWorld] Failed to delete club:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Force claim handlers
  const handleForceClaimClick = (club: WorldClub) => {
    setClubToForceClaim(club)
    setForceClaimProfileId('')
    setForceClaimError(null)
    setForceClaimOpen(true)
  }

  const handleForceClaimConfirm = async () => {
    if (!clubToForceClaim) return

    const trimmedId = forceClaimProfileId.trim()
    if (!UUID_REGEX.test(trimmedId)) {
      setForceClaimError('Please enter a valid UUID (e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890)')
      return
    }

    setIsForceClaiming(true)
    setForceClaimError(null)
    try {
      await forceClaimWorldClub(clubToForceClaim.id, trimmedId)
      setForceClaimOpen(false)
      setClubToForceClaim(null)
      loadClubs()
      loadStats()
    } catch (err) {
      logger.error('[AdminWorld] Failed to force claim:', err)
      setForceClaimError(err instanceof Error ? err.message : 'Failed to claim club. Check the profile UUID.')
    } finally {
      setIsForceClaiming(false)
    }
  }

  const handleModalSaved = () => {
    loadClubs()
    loadStats()
  }

  const handleRefresh = () => {
    loadClubs()
    loadStats()
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe2 className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clubs Directory (World)</h1>
            <p className="text-sm text-gray-500">Manage clubs, leagues, and regions</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Clubs"
          value={stats?.total_clubs ?? '-'}
          loading={loadingStats}
          icon={Globe2}
        />
        <StatCard
          label="Claimed"
          value={stats?.claimed_clubs ?? '-'}
          loading={loadingStats}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          label="Unclaimed"
          value={stats?.unclaimed_clubs ?? '-'}
          loading={loadingStats}
          icon={XCircle}
          color="gray"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            { id: 'clubs' as WorldTab, label: 'Clubs', icon: Building2 },
            { id: 'leagues' as WorldTab, label: 'Leagues', icon: Trophy },
            { id: 'regions' as WorldTab, label: 'Regions', icon: MapPin },
            { id: 'claims' as WorldTab, label: 'Claims', icon: ClipboardCheck },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'clubs' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-2">
                <label htmlFor="world-search" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="world-search"
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Club name or ID..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="world-country" className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                <select
                  id="world-country"
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

              <div>
                <label htmlFor="world-region" className="block text-xs font-medium text-gray-500 mb-1">Region</label>
                <select
                  id="world-region"
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

              <div>
                <label htmlFor="world-claimed" className="block text-xs font-medium text-gray-500 mb-1">Claimed</label>
                <select
                  id="world-claimed"
                  value={filters.is_claimed === undefined ? '' : filters.is_claimed ? 'yes' : 'no'}
                  onChange={(e) => handleFilterChange('is_claimed', e.target.value === '' ? undefined : e.target.value === 'yes')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">All</option>
                  <option value="yes">Claimed only</option>
                  <option value="no">Unclaimed only</option>
                </select>
              </div>

              <div>
                <label htmlFor="world-source" className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                <select
                  id="world-source"
                  value={filters.created_from ?? ''}
                  onChange={(e) => handleFilterChange('created_from', e.target.value || undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">All sources</option>
                  <option value="seed">Seed Data</option>
                  <option value="admin">Admin Created</option>
                  <option value="user">User Created</option>
                </select>
              </div>
            </div>
          </div>

          {/* Clubs header row */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {totalCount} club{totalCount !== 1 ? 's' : ''} total
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh data"
                aria-label="Refresh data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleAddClub}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Club
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Club</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Women&apos;s League</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Men&apos;s League</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claimed By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loadingClubs ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600" />
                        <p className="mt-2 text-sm text-gray-500">Loading clubs...</p>
                      </td>
                    </tr>
                  ) : clubs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                        No clubs found matching your filters
                      </td>
                    </tr>
                  ) : (
                    clubs.map((club) => (
                      <tr key={club.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {club.avatar_url ? (
                              <img src={club.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                                <Shield className="w-4 h-4 text-gray-400" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-gray-900 inline-flex items-center gap-1">
                                {club.club_name}
                                {club.verified_at && (
                                  <BadgeCheck className="w-4 h-4 text-blue-500 flex-shrink-0" aria-label="Verified club" />
                                )}
                              </p>
                              <p className="text-xs text-gray-500">ID: {club.club_id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {club.country_flag_emoji ?? ''} {club.country_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {club.province_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {club.women_league_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {club.men_league_name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {club.is_claimed && club.claimed_profile_id ? (
                            <a
                              href={`/admin/directory?profile=${club.claimed_profile_id}`}
                              className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
                            >
                              <span className="truncate max-w-[120px]">
                                {club.claimed_profile_name || club.claimed_profile_id.slice(0, 8)}
                              </span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            club.created_from === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : club.created_from === 'seed'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {club.created_from}
                          </span>
                          {club.created_by && (
                            <a
                              href={`/admin/directory?profile=${club.created_by}`}
                              className="block mt-1 text-xs text-gray-500 hover:text-purple-600 truncate max-w-[120px]"
                              title={`Added by ${club.created_by_name || club.created_by}`}
                            >
                              by {club.created_by_name || club.created_by.slice(0, 8)}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEditClub(club)}
                              className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Edit club"
                              aria-label={`Edit ${club.club_name}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => void handleToggleVerified(club)}
                              disabled={verifyingClubId === club.id}
                              className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                                club.verified_at
                                  ? 'text-blue-500 hover:text-gray-500 hover:bg-gray-50'
                                  : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                              }`}
                              title={club.verified_at ? 'Remove verified mark' : 'Mark as verified'}
                              aria-label={`${club.verified_at ? 'Remove verified mark from' : 'Mark'} ${club.club_name} ${club.verified_at ? '' : 'as verified'}`}
                            >
                              <BadgeCheck className="w-4 h-4" />
                            </button>
                            {!club.is_claimed && (
                              <button
                                onClick={() => handleForceClaimClick(club)}
                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Force claim"
                                aria-label={`Force claim ${club.club_name}`}
                              >
                                <UserPlus className="w-4 h-4" />
                              </button>
                            )}
                            {club.is_claimed && (
                              <button
                                onClick={() => handleUnclaimClick(club)}
                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Unclaim club"
                                aria-label={`Unclaim ${club.club_name}`}
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteClick(club)}
                              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete club"
                              aria-label={`Delete ${club.club_name}`}
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
            {!loadingClubs && totalCount > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                <p className="text-sm text-gray-600">
                  Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} clubs
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
          <EditWorldClubModal
            isOpen={editModalOpen}
            onClose={() => setEditModalOpen(false)}
            onSaved={handleModalSaved}
            club={selectedClub}
          />

          {/* Unclaim Confirm Dialog */}
          <ConfirmDialog
            isOpen={unclaimDialogOpen}
            title="Unclaim Club"
            message={
              clubToUnclaim
                ? `Are you sure you want to unclaim "${clubToUnclaim.club_name}"? This will remove the link to the profile "${clubToUnclaim.claimed_profile_name || clubToUnclaim.claimed_profile_id}".`
                : ''
            }
            confirmLabel="Unclaim"
            variant="danger"
            onConfirm={handleUnclaimConfirm}
            onClose={() => { setUnclaimDialogOpen(false); setClubToUnclaim(null) }}
            loading={isUnclaiming}
          />

          {/* Delete Confirm Dialog */}
          <ConfirmDialog
            isOpen={deleteDialogOpen}
            title="Delete Club"
            message={
              clubToDelete
                ? clubToDelete.is_claimed
                  ? `Are you sure you want to permanently delete "${clubToDelete.club_name}"? This club is currently claimed by ${clubToDelete.claimed_profile_name || clubToDelete.claimed_profile_id}. This action cannot be undone. Type DELETE to confirm.`
                  : `Are you sure you want to permanently delete "${clubToDelete.club_name}"? This action cannot be undone.`
                : ''
            }
            confirmLabel="Delete"
            confirmText={clubToDelete?.is_claimed ? 'DELETE' : undefined}
            variant="danger"
            onConfirm={handleDeleteConfirm}
            onClose={() => { setDeleteDialogOpen(false); setClubToDelete(null) }}
            loading={isDeleting}
          />

          {/* Force Claim Dialog */}
          {forceClaimOpen && clubToForceClaim && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setForceClaimOpen(false)} />
              <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Force Claim Club</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Assign &ldquo;{clubToForceClaim.club_name}&rdquo; to a profile by entering the profile UUID.
                </p>
                {forceClaimError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-600">{forceClaimError}</p>
                  </div>
                )}
                <label htmlFor="force-claim-profile" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Profile ID <span className="text-red-500">*</span>
                </label>
                <input
                  id="force-claim-profile"
                  type="text"
                  value={forceClaimProfileId}
                  onChange={(e) => setForceClaimProfileId(e.target.value)}
                  placeholder="e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent mb-4"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setForceClaimOpen(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    disabled={isForceClaiming}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleForceClaimConfirm}
                    disabled={!forceClaimProfileId.trim() || isForceClaiming}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isForceClaiming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Claiming...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Force Claim
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'leagues' && <AdminWorldLeagues />}
      {activeTab === 'regions' && <AdminWorldRegions />}
      {activeTab === 'claims' && <AdminWorldClaims />}
    </div>
  )
}
