/**
 * AdminPreferences Page
 *
 * Analytics dashboard for user notification preferences and privacy settings.
 * Shows enabled/disabled counts per setting with role breakdown and user drill-down.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Bell,
  BellOff,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Users,
  Search,
} from 'lucide-react'
import { getPreferenceSummary, getPreferenceUsers } from '../api/preferencesApi'
import type { PreferenceSummary, PreferenceStat, PreferenceKey, PreferenceUser } from '../types'
import { logger } from '@/lib/logger'

// Preference metadata for display
const PREFERENCE_CONFIG: Array<{
  key: PreferenceKey
  label: string
  description: string
  section: 'notification' | 'privacy'
  defaultOn: boolean
}> = [
  { key: 'notify_applications', label: 'Application Notifications', description: 'Email when players apply to opportunities', section: 'notification', defaultOn: true },
  { key: 'notify_friends', label: 'Friend Request Emails', description: 'Email when someone sends a friend request', section: 'notification', defaultOn: true },
  { key: 'notify_references', label: 'Reference Request Emails', description: 'Email when someone requests a reference', section: 'notification', defaultOn: true },
  { key: 'notify_messages', label: 'Message Email Digests', description: 'Email digest for unread messages (max once every 6 hours)', section: 'notification', defaultOn: true },
  { key: 'notify_opportunities', label: 'Opportunity Notifications', description: 'Email when clubs publish new opportunities', section: 'notification', defaultOn: true },
  { key: 'notify_push', label: 'Push Notifications', description: 'Receive notifications even when the app is closed', section: 'notification', defaultOn: true },
  { key: 'notify_profile_views', label: 'Profile View Emails', description: 'Weekly email summary of who viewed your profile', section: 'notification', defaultOn: true },
  { key: 'browse_anonymously', label: 'Anonymous Browsing', description: 'When enabled, user won\'t appear in others\' profile viewer lists', section: 'privacy', defaultOn: false },
]

const ROLE_COLORS: Record<string, string> = {
  player: 'bg-[#EFF6FF] text-[#2563EB]',
  coach: 'bg-[#F0FDFA] text-[#0D9488]',
  club: 'bg-[#FFF7ED] text-[#EA580C]',
  brand: 'bg-[#FFF1F2] text-[#E11D48]',
  umpire: 'bg-[#FEFCE8] text-[#A16207]',
}

const PAGE_SIZE = 50

export function AdminPreferences() {
  const [summary, setSummary] = useState<PreferenceSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<PreferenceKey | null>(null)

  const fetchSummary = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getPreferenceSummary()
      setSummary(data)
    } catch (err) {
      logger.error('[AdminPreferences] Failed to load summary:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  const notificationPrefs = PREFERENCE_CONFIG.filter(p => p.section === 'notification')
  const privacyPrefs = PREFERENCE_CONFIG.filter(p => p.section === 'privacy')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Preferences</h1>
          <p className="text-sm text-gray-500 mt-1">
            How users configure their notification and privacy settings
          </p>
        </div>
        <button
          type="button"
          onClick={fetchSummary}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      ) : summary ? (
        <>
          {/* Total users context */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-gray-400" />
            <p className="text-sm text-gray-600">
              Based on <span className="font-semibold text-gray-900">{summary.total_users.toLocaleString()}</span> active users (onboarded, not blocked, not test)
            </p>
          </div>

          {/* Notification Preferences */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800">Notification Preferences</h2>
            {notificationPrefs.map((pref) => (
              <PreferenceRow
                key={pref.key}
                prefKey={pref.key}
                label={pref.label}
                description={pref.description}
                defaultOn={pref.defaultOn}
                stat={summary.preferences[pref.key]}
                totalUsers={summary.total_users}
                isExpanded={expandedKey === pref.key}
                onToggleExpand={() => setExpandedKey(expandedKey === pref.key ? null : pref.key)}
              />
            ))}
          </div>

          {/* Privacy Settings */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800">Privacy Settings</h2>
            {privacyPrefs.map((pref) => (
              <PreferenceRow
                key={pref.key}
                prefKey={pref.key}
                label={pref.label}
                description={pref.description}
                defaultOn={pref.defaultOn}
                stat={summary.preferences[pref.key]}
                totalUsers={summary.total_users}
                isExpanded={expandedKey === pref.key}
                onToggleExpand={() => setExpandedKey(expandedKey === pref.key ? null : pref.key)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-20">
          <p className="text-gray-500">Failed to load preference data.</p>
        </div>
      )}
    </div>
  )
}

// ─── PreferenceRow ────────────────────────────────────────────────────────────

interface PreferenceRowProps {
  prefKey: PreferenceKey
  label: string
  description: string
  defaultOn: boolean
  stat: PreferenceStat
  totalUsers: number
  isExpanded: boolean
  onToggleExpand: () => void
}

function PreferenceRow({ prefKey, label, description, defaultOn, stat, totalUsers, isExpanded, onToggleExpand }: PreferenceRowProps) {
  const enabledPct = totalUsers > 0 ? Math.round((stat.enabled / totalUsers) * 100) : 0
  const disabledPct = totalUsers > 0 ? Math.round((stat.disabled / totalUsers) * 100) : 0

  // For "browse_anonymously" the concern is users who turned it ON (non-default)
  // For notifications the concern is users who turned them OFF (non-default)
  const nonDefaultCount = defaultOn ? stat.disabled : stat.enabled
  const isHealthy = defaultOn ? disabledPct <= 10 : enabledPct <= 10

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Summary bar */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
            {nonDefaultCount > 0 && !isHealthy && (
              <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                {nonDefaultCount} changed from default
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>

        {/* Bar chart */}
        <div className="w-48 flex-shrink-0 hidden sm:block">
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
            <div
              className="bg-green-500 transition-all"
              style={{ width: `${enabledPct}%` }}
            />
            <div
              className="bg-red-400 transition-all"
              style={{ width: `${disabledPct}%` }}
            />
          </div>
        </div>

        {/* Counts */}
        <div className="flex items-center gap-4 flex-shrink-0 text-sm">
          <div className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-green-600" />
            <span className="font-medium text-green-700">{stat.enabled}</span>
            <span className="text-gray-400 text-xs">({enabledPct}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BellOff className="w-3.5 h-3.5 text-red-500" />
            <span className="font-medium text-red-600">{stat.disabled}</span>
            <span className="text-gray-400 text-xs">({disabledPct}%)</span>
          </div>
        </div>

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          {/* Role breakdown */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Breakdown by role</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['player', 'coach', 'club', 'brand', 'umpire'].map((role) => {
                const roleData = stat.by_role[role]
                if (!roleData) return null
                const total = roleData.enabled + roleData.disabled
                const pct = total > 0 ? Math.round((roleData.enabled / total) * 100) : 0
                return (
                  <div key={role} className="bg-white rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${ROLE_COLORS[role] || 'bg-gray-100 text-gray-600'}`}>
                        {role}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 space-y-0.5">
                      <p><span className="text-green-600 font-medium">{roleData.enabled}</span> on ({pct}%)</p>
                      <p><span className="text-red-500 font-medium">{roleData.disabled}</span> off</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* User drill-down */}
          <UserDrillDown prefKey={prefKey} />
        </div>
      )}
    </div>
  )
}

// ─── UserDrillDown ────────────────────────────────────────────────────────────

function UserDrillDown({ prefKey }: { prefKey: PreferenceKey }) {
  const [tab, setTab] = useState<'enabled' | 'disabled'>('disabled')
  const [users, setUsers] = useState<PreferenceUser[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { setPage(0) }, [tab, roleFilter, debouncedSearch])

  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getPreferenceUsers({
        preference: prefKey,
        enabled: tab === 'enabled',
        role: roleFilter || undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setUsers(result.users)
      setTotalCount(result.totalCount)
    } catch (err) {
      logger.error('[AdminPreferences] Failed to load users:', err)
    } finally {
      setIsLoading(false)
    }
  }, [prefKey, tab, roleFilter, debouncedSearch, page])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="px-5 py-4 space-y-3">
      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setTab('disabled')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === 'disabled' ? 'bg-red-50 text-red-700' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <BellOff className="w-3 h-3 inline mr-1" />
            Disabled
          </button>
          <button
            type="button"
            onClick={() => setTab('enabled')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
              tab === 'enabled' ? 'bg-green-50 text-green-700' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Bell className="w-3 h-3 inline mr-1" />
            Enabled
          </button>
        </div>

        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">All roles</option>
          <option value="player">Player</option>
          <option value="coach">Coach</option>
          <option value="club">Club</option>
          <option value="brand">Brand</option>
        </select>
      </div>

      {/* User list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No users found</p>
      ) : (
        <>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">User</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Email</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Role</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-medium text-gray-500">
                              {user.full_name?.charAt(0) || '?'}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-gray-900 truncate max-w-[150px]">
                          {user.full_name || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-500 font-mono truncate max-w-[200px]">{user.email}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] text-gray-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="text-[10px] text-gray-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AdminPreferences
