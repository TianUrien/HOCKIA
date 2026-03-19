/**
 * AdminDataIssues Page
 * 
 * Shows data integrity issues: orphan records, broken references, etc.
 */

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  RefreshCw,
  Trash2,
  UserX,
  Link2Off,
  Users,
} from 'lucide-react'
import { DataTable, ConfirmDialog } from '../components'
import type { Column, Action } from '../components'
import { useDataIssues } from '../hooks/useDataIssues'
import type { AuthOrphan, ProfileOrphan } from '../types'
import { deleteAuthUser, deleteOrphanProfile } from '../api/adminApi'
import { formatAdminDate } from '../utils/formatDate'

type TabType = 'auth-orphans' | 'profile-orphans' | 'broken-refs'

export function AdminDataIssues() {
  const [activeTab, setActiveTab] = useState<TabType>('auth-orphans')
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    type: 'delete-auth' | 'delete-profile'
    target: AuthOrphan | ProfileOrphan | null
  }>({ isOpen: false, type: 'delete-auth', target: null })

  const {
    authOrphans,
    profileOrphans,
    brokenReferences,
    isLoading,
    error,
    fetchAll,
  } = useDataIssues()

  useEffect(() => {
    document.title = 'Data Issues | HOCKIA Admin'
    fetchAll()
  }, [fetchAll])

  const handleDeleteAuthUser = async () => {
    if (!confirmDialog.target || confirmDialog.type !== 'delete-auth') return
    const orphan = confirmDialog.target as AuthOrphan
    await deleteAuthUser(orphan.user_id, 'Orphan cleanup from admin portal')
    await fetchAll()
  }

  const handleDeleteOrphanProfile = async () => {
    if (!confirmDialog.target || confirmDialog.type !== 'delete-profile') return
    const orphan = confirmDialog.target as ProfileOrphan
    await deleteOrphanProfile(orphan.profile_id)
    await fetchAll()
  }

  const authOrphanColumns: Column<AuthOrphan>[] = [
    {
      key: 'email',
      label: 'Email',
      render: (value) => (
        <span className="font-medium text-gray-900">{String(value)}</span>
      ),
    },
    {
      key: 'intended_role',
      label: 'Intended Role',
      render: (value) => (
        <span className="capitalize">{String(value ?? 'Unknown')}</span>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (value) => formatAdminDate(String(value)),
    },
    {
      key: 'email_confirmed_at',
      label: 'Email Confirmed',
      render: (value) =>
        value ? (
          <span className="text-green-600">Yes</span>
        ) : (
          <span className="text-gray-400">No</span>
        ),
    },
    {
      key: 'last_sign_in_at',
      label: 'Last Sign In',
      render: (value) =>
        value ? formatAdminDate(String(value)) : 'Never',
    },
  ]

  const authOrphanActions: Action<AuthOrphan>[] = [
    {
      label: 'Delete Auth User',
      icon: <Trash2 className="w-4 h-4" />,
      variant: 'danger',
      onClick: (row) =>
        setConfirmDialog({ isOpen: true, type: 'delete-auth', target: row }),
    },
  ]

  const profileOrphanColumns: Column<ProfileOrphan>[] = [
    {
      key: 'email',
      label: 'Email',
      render: (value) => (
        <span className="font-medium text-gray-900">{String(value)}</span>
      ),
    },
    {
      key: 'full_name',
      label: 'Name',
      render: (value) => String(value ?? '-'),
    },
    {
      key: 'role',
      label: 'Role',
      render: (value) => (
        <span className="capitalize">{String(value)}</span>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (value) => formatAdminDate(String(value)),
    },
  ]

  const profileOrphanActions: Action<ProfileOrphan>[] = [
    {
      label: 'Delete Profile',
      icon: <Trash2 className="w-4 h-4" />,
      variant: 'danger',
      onClick: (row) =>
        setConfirmDialog({ isOpen: true, type: 'delete-profile', target: row }),
    },
  ]

  // Count broken references
  const brokenRefCounts = {
    applications_missing_player: brokenReferences?.applications_missing_player?.length ?? 0,
    applications_missing_vacancy: brokenReferences?.applications_missing_vacancy?.length ?? 0,
    vacancies_missing_club: brokenReferences?.vacancies_missing_club?.length ?? 0,
    messages_missing_sender: brokenReferences?.messages_missing_sender?.length ?? 0,
    friendships_missing_users: brokenReferences?.friendships_missing_users?.length ?? 0,
  }
  const totalBrokenRefs = Object.values(brokenRefCounts).reduce((a, b) => a + b, 0)

  const tabs = [
    {
      id: 'auth-orphans' as TabType,
      label: 'Auth Orphans',
      icon: UserX,
      count: authOrphans.length,
    },
    {
      id: 'profile-orphans' as TabType,
      label: 'Profile Orphans',
      icon: Users,
      count: profileOrphans.length,
    },
    {
      id: 'broken-refs' as TabType,
      label: 'Broken References',
      icon: Link2Off,
      count: totalBrokenRefs,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Issues</h1>
          <p className="text-sm text-gray-500 mt-1">
            Find and fix data integrity problems
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Scan
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Error loading data issues</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
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
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${
                  tab.count > 0
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      {activeTab === 'auth-orphans' && (
        <div>
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              These are auth users (in <code className="bg-gray-100 px-1 rounded">auth.users</code>)
              that don&apos;t have a corresponding profile record. Usually happens when signup
              is interrupted before profile creation.
            </p>
          </div>
          <DataTable
            data={authOrphans}
            columns={authOrphanColumns}
            actions={authOrphanActions}
            keyField="user_id"
            loading={isLoading}
            emptyMessage="No auth orphans found. All auth users have profiles!"
          />
        </div>
      )}

      {activeTab === 'profile-orphans' && (
        <div>
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              These are profile records that don&apos;t have a corresponding auth user. This is
              rare and usually indicates a data migration issue or manual database edit.
            </p>
          </div>
          <DataTable
            data={profileOrphans}
            columns={profileOrphanColumns}
            actions={profileOrphanActions}
            keyField="profile_id"
            loading={isLoading}
            emptyMessage="No profile orphans found. All profiles have auth users!"
          />
        </div>
      )}

      {activeTab === 'broken-refs' && (
        <div className="space-y-6">
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              These are records with foreign key references to non-existent entities.
              They should be cleaned up to maintain data integrity.
            </p>
          </div>

          {totalBrokenRefs === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <p className="text-green-800 font-medium">
                ✅ No broken references found!
              </p>
              <p className="text-sm text-green-600 mt-1">
                All foreign key relationships are intact.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {Object.entries(brokenRefCounts).map(([key, count]) => (
                <div
                  key={key}
                  className={`bg-white rounded-xl border p-4 ${
                    count > 0 ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {count} record{count !== 1 ? 's' : ''} with broken references
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 text-sm font-medium rounded-full ${
                        count > 0
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={
          confirmDialog.type === 'delete-auth'
            ? handleDeleteAuthUser
            : handleDeleteOrphanProfile
        }
        title={
          confirmDialog.type === 'delete-auth'
            ? 'Delete Auth User'
            : 'Delete Orphan Profile'
        }
        message={
          confirmDialog.type === 'delete-auth'
            ? `This will permanently delete the auth user "${(confirmDialog.target as AuthOrphan)?.email}". This action cannot be undone.`
            : `This will permanently delete the profile "${(confirmDialog.target as ProfileOrphan)?.email}" and all related data. This action cannot be undone.`
        }
        confirmLabel="Delete"
        confirmText="DELETE"
        variant="danger"
      />
    </div>
  )
}
