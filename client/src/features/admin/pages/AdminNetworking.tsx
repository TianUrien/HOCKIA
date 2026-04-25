/**
 * AdminNetworking Page
 *
 * Networking analytics dashboard showing messaging, friendships, and references.
 * Validates platform engagement as a real networking ecosystem.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  RefreshCw,
  MessageSquare,
  MessageCircle,
  Users,
  UserPlus,
  Heart,
  Clock,
  TrendingUp,
  Award,
  AlertTriangle,
  CheckCheck,
  UserX,
  Activity,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components'
import type { Column } from '../components'
import { formatAdminDate, formatAdminDateShort } from '../utils/formatDate'
import {
  getMessagingMetrics,
  getFriendshipMetrics,
  getReferenceMetrics,
} from '../api/adminApi'
import type {
  MessagingMetrics,
  FriendshipMetrics,
  ReferenceMetrics,
  ConversationDetail,
} from '../types'
import { logger } from '@/lib/logger'

type NetworkingTab = 'messaging' | 'friendships' | 'references'
type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, string> = {
  player: 'bg-[#EFF6FF] text-[#2563EB]',
  coach: 'bg-[#F0FDFA] text-[#0D9488]',
  club: 'bg-[#FFF7ED] text-[#EA580C]',
  brand: 'bg-[#FFF1F2] text-[#E11D48]',
  umpire: 'bg-[#FEFCE8] text-[#A16207]',
}

export function AdminNetworking() {
  const [activeTab, setActiveTab] = useState<NetworkingTab>('messaging')
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [excludeTest, setExcludeTest] = useState(true)
  const [roleFilter, setRoleFilter] = useState<string>('')

  const [messaging, setMessaging] = useState<MessagingMetrics | null>(null)
  const [friendships, setFriendships] = useState<FriendshipMetrics | null>(null)
  const [references, setReferences] = useState<ReferenceMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [msgData, friendData, refData] = await Promise.all([
        getMessagingMetrics(daysFilter, excludeTest, roleFilter || undefined),
        getFriendshipMetrics(daysFilter, excludeTest, roleFilter || undefined),
        getReferenceMetrics(daysFilter, excludeTest, roleFilter || undefined),
      ])
      setMessaging(msgData)
      setFriendships(friendData)
      setReferences(refData)
    } catch (err) {
      logger.error('[AdminNetworking] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load networking data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, excludeTest, roleFilter])

  useEffect(() => {
    document.title = 'Networking Analytics | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  // Messaging trend chart data
  const messagingChartData = useMemo(() => {
    const trend = messaging?.messaging_trend || []
    const max = Math.max(...trend.map((d) => d.message_count), 1)
    return { trend, max }
  }, [messaging])

  // Friendship trend chart data
  const friendshipChartData = useMemo(() => {
    const trend = friendships?.friendship_trend || []
    const max = Math.max(...trend.map((d) => d.friendship_count), 1)
    return { trend, max }
  }, [friendships])

  // Conversation relationship table columns
  const conversationColumns: Column<ConversationDetail>[] = [
    {
      key: 'participant_one_name',
      label: 'User A',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {row.participant_one_name || 'Unknown'}
          </span>
          <span
            className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full capitalize ${
              ROLE_COLORS[row.participant_one_role] || 'bg-gray-100 text-gray-600'
            }`}
          >
            {row.participant_one_role}
          </span>
        </div>
      ),
    },
    {
      key: 'participant_two_name',
      label: 'User B',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {row.participant_two_name || 'Unknown'}
          </span>
          <span
            className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full capitalize ${
              ROLE_COLORS[row.participant_two_role] || 'bg-gray-100 text-gray-600'
            }`}
          >
            {row.participant_two_role}
          </span>
        </div>
      ),
    },
    {
      key: 'message_count',
      label: 'Messages',
      render: (value) => (
        <span className="text-sm font-semibold text-gray-900">{Number(value).toLocaleString()}</span>
      ),
    },
    {
      key: 'last_message_at',
      label: 'Last Message',
      render: (value) => (
        <span className="text-sm text-gray-500">{formatAdminDate(String(value))}</span>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load networking data</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Networking Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Messaging, friendships, and references across the platform
          </p>
        </div>
        <button
          type="button"
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Period:</label>
          <select
            aria-label="Filter by time period"
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value) as DaysFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Role:</label>
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Roles</option>
            <option value="player">Players</option>
            <option value="coach">Coaches</option>
            <option value="club">Clubs</option>
            <option value="brand">Brands</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={excludeTest}
            onChange={(e) => setExcludeTest(e.target.checked)}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          Exclude test accounts
        </label>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            { id: 'messaging' as NetworkingTab, label: 'Messaging', icon: MessageSquare },
            { id: 'friendships' as NetworkingTab, label: 'Friendships', icon: Heart },
            { id: 'references' as NetworkingTab, label: 'References', icon: Award },
          ]).map((tab) => (
            <button
              type="button"
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

      {/* ====== MESSAGING TAB ====== */}
      {activeTab === 'messaging' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Active Conversations"
              value={messaging?.active_conversations_30d ?? 0}
              icon={MessageSquare}
              color="purple"
              loading={isLoading}
              trend={{
                value: messaging?.active_conversations_7d ?? 0,
                label: 'in last 7d',
                direction: 'neutral',
              }}
            />
            <StatCard
              label={`Messages (${daysFilter}d)`}
              value={
                daysFilter === 7
                  ? messaging?.messages_7d ?? 0
                  : messaging?.messages_30d ?? 0
              }
              icon={MessageCircle}
              color="blue"
              loading={isLoading}
            />
            <StatCard
              label="Users Who Messaged"
              value={messaging?.users_who_messaged_30d ?? 0}
              icon={Users}
              color="green"
              loading={isLoading}
            />
            <StatCard
              label="Read Rate"
              value={`${messaging?.message_read_rate ?? 0}%`}
              icon={CheckCheck}
              color="amber"
              loading={isLoading}
            />
          </div>

          {/* Message Trend Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Messages per Day
            </h3>
            {isLoading ? (
              <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
            ) : messagingChartData.trend.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
                No messaging activity in this period
              </div>
            ) : (
              <>
                <div className="h-40 flex items-end gap-1">
                  {messagingChartData.trend.map((day, index) => {
                    const height =
                      (day.message_count / messagingChartData.max) * 100
                    const isLast = index === messagingChartData.trend.length - 1
                    return (
                      <div
                        key={day.date}
                        className="flex-1 group relative"
                        title={`${day.date}: ${day.message_count} messages`}
                      >
                        <div
                          className={`w-full rounded-t transition-all ${
                            isLast
                              ? 'bg-purple-600'
                              : 'bg-purple-300 hover:bg-purple-400'
                          }`}
                          style={{
                            height: `${Math.max(height, 2)}%`,
                          }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                          <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                            <div>{formatAdminDate(day.date)}</div>
                            <div>{day.message_count} messages</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>
                    {messagingChartData.trend[0]?.date
                      ? formatAdminDateShort(messagingChartData.trend[0].date)
                      : ''}
                  </span>
                  <span>Today</span>
                </div>
              </>
            )}
          </div>

          {/* Top Messagers */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Top Messagers
            </h3>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (messaging?.top_messagers || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                No messaging activity in this period
              </p>
            ) : (
              <div className="space-y-2">
                {(messaging?.top_messagers || []).map((user, index) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50"
                  >
                    <span className="w-6 text-sm font-medium text-gray-400 text-right">
                      {index + 1}.
                    </span>
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {user.name || 'Unknown'}
                      </span>
                      <span
                        className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full capitalize flex-shrink-0 ${
                          ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {user.role}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {user.message_count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversation Relationships */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Conversation Relationships
            </h3>
            <DataTable
              data={messaging?.top_conversations || []}
              columns={conversationColumns}
              keyField="last_message_at"
              loading={isLoading}
              emptyMessage="No conversations found in this period"
            />
          </div>
        </div>
      )}

      {/* ====== FRIENDSHIPS TAB ====== */}
      {activeTab === 'friendships' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Friendships"
              value={friendships?.total_friendships ?? 0}
              icon={Heart}
              color="purple"
              loading={isLoading}
              trend={{
                value: friendships?.friendships_30d ?? 0,
                label: 'new (30d)',
                direction: (friendships?.friendships_30d ?? 0) > 0 ? 'up' : 'neutral',
              }}
            />
            <StatCard
              label="Pending Requests"
              value={friendships?.pending_requests ?? 0}
              icon={Clock}
              color="amber"
              loading={isLoading}
            />
            <StatCard
              label="Acceptance Rate"
              value={`${friendships?.acceptance_rate ?? 0}%`}
              icon={TrendingUp}
              color="green"
              loading={isLoading}
            />
            <StatCard
              label="Zero Friends"
              value={friendships?.users_with_zero_friends ?? 0}
              icon={UserX}
              color="red"
              loading={isLoading}
            />
          </div>

          {/* Friendship Trend Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              New Friendships per Day
            </h3>
            {isLoading ? (
              <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
            ) : friendshipChartData.trend.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
                No new friendships in this period
              </div>
            ) : (
              <>
                <div className="h-40 flex items-end gap-1">
                  {friendshipChartData.trend.map((day, index) => {
                    const height =
                      (day.friendship_count / friendshipChartData.max) * 100
                    const isLast =
                      index === friendshipChartData.trend.length - 1
                    return (
                      <div
                        key={day.date}
                        className="flex-1 group relative"
                        title={`${day.date}: ${day.friendship_count} friendships`}
                      >
                        <div
                          className={`w-full rounded-t transition-all ${
                            isLast
                              ? 'bg-green-600'
                              : 'bg-green-300 hover:bg-green-400'
                          }`}
                          style={{
                            height: `${Math.max(height, 2)}%`,
                          }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                          <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                            <div>{formatAdminDate(day.date)}</div>
                            <div>{day.friendship_count} friendships</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>
                    {friendshipChartData.trend[0]?.date
                      ? formatAdminDateShort(friendshipChartData.trend[0].date)
                      : ''}
                  </span>
                  <span>Today</span>
                </div>
              </>
            )}
          </div>

          {/* Avg Friends + Top Connectors side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Quick Stats */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Friendship Stats</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Avg friends per user</span>
                  <span className="text-lg font-bold text-gray-900">
                    {friendships?.avg_friends_per_user ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">New (7d)</span>
                  <span className="text-lg font-bold text-gray-900">
                    {friendships?.friendships_7d ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">New (30d)</span>
                  <span className="text-lg font-bold text-gray-900">
                    {friendships?.friendships_30d ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Top Connectors */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Top Connectors</h3>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-8 bg-gray-100 rounded animate-pulse"
                    />
                  ))}
                </div>
              ) : (friendships?.top_connectors || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  No friendship data available
                </p>
              ) : (
                <div className="space-y-2">
                  {(friendships?.top_connectors || []).map((user, index) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 py-1.5"
                    >
                      <span className="w-6 text-sm font-medium text-gray-400 text-right">
                        {index + 1}.
                      </span>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {user.name || 'Unknown'}
                        </span>
                        <span
                          className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full capitalize flex-shrink-0 ${
                            ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {user.role}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {user.friend_count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== REFERENCES TAB ====== */}
      {activeTab === 'references' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total References"
              value={references?.total_references ?? 0}
              icon={Award}
              color="purple"
              loading={isLoading}
            />
            <StatCard
              label="Pending"
              value={references?.pending_references ?? 0}
              icon={Clock}
              color="amber"
              loading={isLoading}
            />
            <StatCard
              label="Acceptance Rate"
              value={`${references?.reference_acceptance_rate ?? 0}%`}
              icon={TrendingUp}
              color="green"
              loading={isLoading}
            />
            <StatCard
              label="Users with References"
              value={references?.users_with_references ?? 0}
              icon={UserPlus}
              color="blue"
              loading={isLoading}
            />
          </div>

          {/* References summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">References Overview</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-sm text-gray-500">Accepted</p>
                <p className="text-2xl font-bold text-gray-900">
                  {references?.total_references ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-2xl font-bold text-amber-600">
                  {references?.pending_references ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">New (30d)</p>
                <p className="text-2xl font-bold text-green-600">
                  {references?.references_30d ?? 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Acceptance Rate</p>
                <p className="text-2xl font-bold text-purple-600">
                  {references?.reference_acceptance_rate ?? 0}%
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== NETWORK HEALTH SUMMARY ====== */}
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border border-purple-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900">Network Health</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {messaging?.users_who_messaged_30d ?? 0}
            </p>
            <p className="text-sm text-gray-600 mt-1">Active messagers (30d)</p>
          </div>
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">
              {friendships?.total_friendships ?? 0}
            </p>
            <p className="text-sm text-gray-600 mt-1">Total connections</p>
          </div>
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">
              {messaging?.users_never_messaged ?? 0}
            </p>
            <p className="text-sm text-gray-600 mt-1">Users never messaged</p>
          </div>
        </div>
        {messaging && (
          <p className="text-xs text-gray-500 mt-4 text-center">
            Avg {messaging.avg_messages_per_conversation} messages per conversation
            &middot; {messaging.total_conversations} total conversations
          </p>
        )}
      </div>
    </div>
  )
}
