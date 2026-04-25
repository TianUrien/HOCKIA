/**
 * AdminDirectory Page
 * 
 * Search, view, and manage user profiles.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate, formatAdminDateTime } from '../utils/formatDate'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  RefreshCw,
  Eye,
  Ban,
  CheckCircle,
  BadgeCheck,
  Beaker,
  X,
  User,
  Mail,
  Calendar,
  MapPin,
  Globe,
  Shield,
  AlertTriangle,
  Pencil,
} from 'lucide-react'
import { DataTable, ConfirmDialog, EditUserModal, VerifyProfileDialog, type VerifyMetadata } from '../components'
import { logger } from '@/lib/logger'
import type { Column, Action } from '../components'
import type { AdminProfileListItem, AdminProfileDetails, ProfileSearchParams } from '../types'
import {
  searchProfiles,
  getProfileDetails,
  blockUser,
  unblockUser,
  setTestAccount,
  setProfileVerified,
  updateProfile,
} from '../api/adminApi'

const PAGE_SIZE = 50

export function AdminDirectory() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [profiles, setProfiles] = useState<AdminProfileListItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [testFilter, setTestFilter] = useState<string>('')
  const [page, setPage] = useState(1)

  // Profile detail drawer
  const [selectedProfile, setSelectedProfile] = useState<AdminProfileDetails | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)

  // Edit modal state
  const [editProfile, setEditProfile] = useState<AdminProfileDetails | null>(null)
  const [isLoadingEditProfile, setIsLoadingEditProfile] = useState(false)

  // Confirm dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    type: 'block' | 'unblock' | 'mark-test' | 'unmark-test' | 'verify' | 'unverify'
    profile: AdminProfileListItem | null
  }>({ isOpen: false, type: 'block', profile: null })
  const [blockReason, setBlockReason] = useState('')

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params: ProfileSearchParams = {
        query: searchQuery || undefined,
        role: roleFilter as 'player' | 'coach' | 'club' | 'brand' | 'umpire' | undefined,
        is_blocked: statusFilter === 'blocked' ? true : statusFilter === 'active' || statusFilter === 'incomplete' ? false : undefined,
        onboarding_completed: statusFilter === 'active' ? true : statusFilter === 'incomplete' ? false : undefined,
        is_test_account: testFilter === 'test' ? true : testFilter === 'real' ? false : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }

      const result = await searchProfiles(params)
      setProfiles(result.profiles)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[AdminDirectory] Failed to fetch profiles:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch profiles')
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery, roleFilter, statusFilter, testFilter, page])

  useEffect(() => {
    document.title = 'User Directory | HOCKIA Admin'
    fetchProfiles()
  }, [fetchProfiles])

  // Handle URL parameters for deep linking from global search
  useEffect(() => {
    const profileId = searchParams.get('profile')
    const queryParam = searchParams.get('query')

    // If profile ID is in URL, open the profile drawer
    if (profileId && !selectedProfile) {
      (async () => {
        setIsLoadingProfile(true)
        try {
          const details = await getProfileDetails(profileId)
          setSelectedProfile(details)
        } catch (err) {
          logger.error('[AdminDirectory] Failed to load profile from URL:', err)
        } finally {
          setIsLoadingProfile(false)
        }
        // Clear the URL param after loading
        setSearchParams({}, { replace: true })
      })()
    }

    // If query param exists, set it as search
    if (queryParam && !searchQuery) {
      setSearchQuery(queryParam)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams, selectedProfile, searchQuery])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchProfiles()
  }

  const handleViewProfile = async (profile: AdminProfileListItem) => {
    setIsLoadingProfile(true)
    try {
      const details = await getProfileDetails(profile.id)
      setSelectedProfile(details)
    } catch (err) {
      logger.error('[AdminDirectory] Failed to fetch profile details:', err)
    } finally {
      setIsLoadingProfile(false)
    }
  }

  const handleBlockUser = async () => {
    if (!confirmDialog.profile) return
    await blockUser(confirmDialog.profile.id, blockReason || undefined)
    setBlockReason('')
    await fetchProfiles()
  }

  const handleUnblockUser = async () => {
    if (!confirmDialog.profile) return
    await unblockUser(confirmDialog.profile.id)
    await fetchProfiles()
  }

  const handleToggleTestAccount = async () => {
    if (!confirmDialog.profile) return
    const isMarkingAsTest = confirmDialog.type === 'mark-test'
    await setTestAccount(confirmDialog.profile.id, isMarkingAsTest)
    await fetchProfiles()
  }

  const handleToggleVerified = async (meta: VerifyMetadata) => {
    if (!confirmDialog.profile) return
    const isVerifying = confirmDialog.type === 'verify'
    try {
      await setProfileVerified(confirmDialog.profile.id, isVerifying, {
        sourceUrl: meta.sourceUrl,
        notes: meta.notes,
      })
      await fetchProfiles()
    } catch (err) {
      logger.error('[AdminDirectory] toggle verified failed', err)
    }
  }

  const handleEditUser = async (profile: AdminProfileListItem) => {
    setIsLoadingEditProfile(true)
    try {
      const details = await getProfileDetails(profile.id)
      setEditProfile(details)
    } catch (err) {
      logger.error('[AdminDirectory] Failed to fetch profile for editing:', err)
    } finally {
      setIsLoadingEditProfile(false)
    }
  }

  const handleSaveEdit = async (updates: Record<string, unknown>, reason?: string) => {
    if (!editProfile) return
    await updateProfile(editProfile.profile.id, updates, reason)
    setEditProfile(null)
    await fetchProfiles()
  }

  const columns: Column<AdminProfileListItem>[] = [
    {
      key: 'full_name',
      label: 'User',
      render: (_, row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
            {row.avatar_url ? (
              <img
                src={row.avatar_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4 text-gray-400" />
            )}
          </div>
          <div>
            <p className="font-medium text-gray-900">{row.full_name || 'No name'}</p>
            <p className="text-xs text-gray-500">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (value) => {
        const roleColors: Record<string, string> = {
          player: 'bg-[#EFF6FF] text-[#2563EB]',
          coach: 'bg-[#F0FDFA] text-[#0D9488]',
          club: 'bg-[#FFF7ED] text-[#EA580C]',
          brand: 'bg-[#FFF1F2] text-[#E11D48]',
          umpire: 'bg-[#FEFCE8] text-[#A16207]',
        }
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
              roleColors[String(value)] || 'bg-gray-100 text-gray-600'
            }`}
          >
            {String(value)}
          </span>
        )
      },
    },
    {
      key: 'nationality',
      label: 'Nationality',
      render: (_, row) => (
        <div className="text-sm text-gray-600">
          {row.nationality || '-'}
        </div>
      ),
    },
    {
      key: 'nationality2',
      label: 'Secondary',
      render: (_, row) => (
        <div className="text-sm text-gray-600">
          {row.nationality2 || '-'}
        </div>
      ),
    },
    {
      key: 'base_location',
      label: 'Location',
      render: (_, row) => (
        <div className="text-sm text-gray-600">
          {row.base_location || '-'}
        </div>
      ),
    },
    {
      key: 'is_blocked',
      label: 'Status',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          {row.is_blocked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              <Ban className="w-3 h-3" /> Blocked
            </span>
          )}
          {row.is_test_account && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
              <Beaker className="w-3 h-3" /> Test
            </span>
          )}
          {row.is_verified && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
              <BadgeCheck className="w-3 h-3" /> Verified
            </span>
          )}
          {!row.onboarding_completed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
              Incomplete
            </span>
          )}
          {!row.is_blocked && !row.is_test_account && row.onboarding_completed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
              <CheckCircle className="w-3 h-3" /> Active
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Joined',
      render: (value) => (
        <span className="text-sm text-gray-500">
          {formatAdminDate(String(value))}
        </span>
      ),
    },
  ]

  const actions: Action<AdminProfileListItem>[] = [
    {
      label: 'View Details',
      icon: <Eye className="w-4 h-4" />,
      onClick: handleViewProfile,
    },
    {
      label: 'Edit User',
      icon: <Pencil className="w-4 h-4" />,
      onClick: handleEditUser,
    },
    {
      label: 'Block User',
      icon: <Ban className="w-4 h-4" />,
      variant: 'danger',
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'block', profile: row }),
      disabled: (row) => row.is_blocked,
    },
    {
      label: 'Unblock User',
      icon: <CheckCircle className="w-4 h-4" />,
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'unblock', profile: row }),
      disabled: (row) => !row.is_blocked,
    },
    {
      label: 'Mark as Test',
      icon: <Beaker className="w-4 h-4" />,
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'mark-test', profile: row }),
      disabled: (row) => row.is_test_account,
    },
    {
      label: 'Unmark Test',
      icon: <Beaker className="w-4 h-4" />,
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'unmark-test', profile: row }),
      disabled: (row) => !row.is_test_account,
    },
    {
      label: 'Verify Profile',
      icon: <BadgeCheck className="w-4 h-4" />,
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'verify', profile: row }),
      disabled: (row) => row.is_verified,
    },
    {
      label: 'Remove Verification',
      icon: <BadgeCheck className="w-4 h-4" />,
      onClick: (row) => setConfirmDialog({ isOpen: true, type: 'unverify', profile: row }),
      disabled: (row) => !row.is_verified,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Directory</h1>
          <p className="text-sm text-gray-500 mt-1">
            Search and manage all users on the platform
          </p>
        </div>
        <button
          onClick={fetchProfiles}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, or ID..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoComplete="off"
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            aria-label="Filter by role"
            title="Filter by role"
          >
            <option value="">All Roles</option>
            <option value="player">Players</option>
            <option value="coach">Coaches</option>
            <option value="club">Clubs</option>
            <option value="brand">Brands</option>
            <option value="umpire">Umpires</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            aria-label="Filter by status"
            title="Filter by status"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="incomplete">Incomplete</option>
            <option value="blocked">Blocked</option>
          </select>

          <select
            value={testFilter}
            onChange={(e) => {
              setTestFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            aria-label="Filter by account type"
            title="Filter by account type"
          >
            <option value="">All Accounts</option>
            <option value="real">Real Users</option>
            <option value="test">Test Accounts</option>
          </select>

          <button
            type="submit"
            className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Error loading profiles</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      <DataTable
        data={profiles}
        columns={columns}
        actions={actions}
        keyField="id"
        loading={isLoading}
        emptyMessage="No users found matching your criteria"
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalCount,
          onPageChange: setPage,
        }}
      />

      {/* Profile Detail Drawer */}
      {(selectedProfile || isLoadingProfile) && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setSelectedProfile(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Profile Details</h2>
              <button
                onClick={() => setSelectedProfile(null)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingProfile ? (
              <div className="p-6 animate-pulse space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-gray-200 rounded-full" />
                  <div className="space-y-2">
                    <div className="h-5 w-32 bg-gray-200 rounded" />
                    <div className="h-4 w-24 bg-gray-200 rounded" />
                  </div>
                </div>
                <div className="h-4 w-full bg-gray-200 rounded" />
                <div className="h-4 w-3/4 bg-gray-200 rounded" />
              </div>
            ) : selectedProfile ? (
              <div className="p-6 space-y-6">
                {/* Avatar & Basic Info */}
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {selectedProfile.profile.avatar_url ? (
                      <img
                        src={selectedProfile.profile.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-8 h-8 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold text-gray-900 truncate">
                      {selectedProfile.profile.full_name || 'No name'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      @{selectedProfile.profile.username || 'no-username'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {(() => {
                        const roleColors: Record<string, string> = {
                          player: 'bg-[#EFF6FF] text-[#2563EB]',
                          coach: 'bg-[#F0FDFA] text-[#0D9488]',
                          club: 'bg-[#FFF7ED] text-[#EA580C]',
                          brand: 'bg-[#FFF1F2] text-[#E11D48]',
                          umpire: 'bg-[#FEFCE8] text-[#A16207]',
                        }
                        return (
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                              roleColors[selectedProfile.profile.role] || 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {selectedProfile.profile.role}
                          </span>
                        )
                      })()}
                      {selectedProfile.profile.is_blocked && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                          <Ban className="w-3 h-3" /> Blocked
                        </span>
                      )}
                      {selectedProfile.profile.is_test_account && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                          <Beaker className="w-3 h-3" /> Test
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Contact
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{selectedProfile.profile.email}</span>
                    </div>
                    {selectedProfile.profile.base_location && (
                      <div className="flex items-center gap-3 text-sm">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-900">{selectedProfile.profile.base_location}</span>
                      </div>
                    )}
                    {selectedProfile.profile.nationality && (
                      <div className="flex items-center gap-3 text-sm">
                        <Globe className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-900">{selectedProfile.profile.nationality}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Auth Info */}
                {selectedProfile.auth_user && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Authentication
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-sm">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Created:</span>
                        <span className="text-gray-900">
                          {formatAdminDateTime(selectedProfile.auth_user.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Last sign in:</span>
                        <span className="text-gray-900">
                          {selectedProfile.auth_user.last_sign_in_at
                            ? formatAdminDateTime(selectedProfile.auth_user.last_sign_in_at)
                            : 'Never'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <Shield className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Email verified:</span>
                        <span className={selectedProfile.auth_user.email_confirmed_at ? 'text-green-600' : 'text-amber-600'}>
                          {selectedProfile.auth_user.email_confirmed_at ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Activity Stats
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selectedProfile.stats).map(([key, value]) => (
                      <div
                        key={key}
                        className="bg-gray-50 rounded-lg p-3"
                      >
                        <p className="text-2xl font-bold text-gray-900">{value}</p>
                        <p className="text-xs text-gray-500 capitalize">
                          {key.replace(/_/g, ' ').replace(' count', '')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blocked Info */}
                {selectedProfile.profile.is_blocked && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-red-800 mb-2">
                      Account Blocked
                    </h4>
                    {selectedProfile.profile.blocked_at && (
                      <p className="text-sm text-red-600">
                        Blocked on: {formatAdminDateTime(selectedProfile.profile.blocked_at)}
                      </p>
                    )}
                    {selectedProfile.profile.blocked_reason && (
                      <p className="text-sm text-red-600 mt-1">
                        Reason: {selectedProfile.profile.blocked_reason}
                      </p>
                    )}
                  </div>
                )}

                {/* ID for reference */}
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-400">
                    Profile ID: <code className="bg-gray-100 px-1 rounded">{selectedProfile.profile.id}</code>
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen && confirmDialog.type === 'block'}
        onClose={() => {
          setConfirmDialog({ ...confirmDialog, isOpen: false })
          setBlockReason('')
        }}
        onConfirm={handleBlockUser}
        title="Block User"
        message={`Are you sure you want to block "${confirmDialog.profile?.full_name || confirmDialog.profile?.email}"? They will not be able to access the platform.`}
        confirmLabel="Block User"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen && confirmDialog.type === 'unblock'}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={handleUnblockUser}
        title="Unblock User"
        message={`Are you sure you want to unblock "${confirmDialog.profile?.full_name || confirmDialog.profile?.email}"? They will regain access to the platform.`}
        confirmLabel="Unblock User"
        variant="warning"
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen && (confirmDialog.type === 'mark-test' || confirmDialog.type === 'unmark-test')}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={handleToggleTestAccount}
        title={confirmDialog.type === 'mark-test' ? 'Mark as Test Account' : 'Remove Test Flag'}
        message={
          confirmDialog.type === 'mark-test'
            ? `This will mark "${confirmDialog.profile?.full_name || confirmDialog.profile?.email}" as a test account. They will be hidden from real users.`
            : `This will remove the test flag from "${confirmDialog.profile?.full_name || confirmDialog.profile?.email}". They will become visible to all users.`
        }
        confirmLabel={confirmDialog.type === 'mark-test' ? 'Mark as Test' : 'Remove Test Flag'}
        variant="warning"
      />

      <VerifyProfileDialog
        isOpen={confirmDialog.isOpen && (confirmDialog.type === 'verify' || confirmDialog.type === 'unverify')}
        mode={confirmDialog.type === 'verify' ? 'verify' : 'unverify'}
        profileName={confirmDialog.profile?.full_name || confirmDialog.profile?.email || ''}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={handleToggleVerified}
      />

      {/* Edit User Modal */}
      <EditUserModal
        isOpen={editProfile !== null || isLoadingEditProfile}
        onClose={() => setEditProfile(null)}
        onSave={handleSaveEdit}
        profile={editProfile?.profile ?? null}
      />
    </div>
  )
}
