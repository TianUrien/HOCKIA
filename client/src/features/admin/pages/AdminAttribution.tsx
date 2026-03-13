/**
 * AdminAttribution Page
 *
 * Cross-feature attribution analytics showing how features drive conversions
 * across the platform (profile views → messages, vacancy views → applications, etc.)
 */

import { useState, useCallback, useEffect } from 'react'
import {
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Eye,
  Mail,
  UserPlus,
  Briefcase,
  Bell,
} from 'lucide-react'
import { getCrossFeatureAttribution } from '../api/analyticsApi'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90
type WindowHours = 24 | 48 | 168

const WINDOW_LABELS: Record<WindowHours, string> = {
  24: '24h',
  48: '48h',
  168: '7d',
}

interface ConversionPath {
  total_profile_viewers?: number
  total_vacancy_viewers?: number
  converted_to_message?: number
  converted_to_friend_request?: number
  converted_to_application?: number
  conversion_rate?: number
}

interface NotificationAction {
  kind: string
  clickers: number
  action_takers: number
  action_rate: number
}

interface AttributionData {
  profile_to_message: ConversionPath
  profile_to_friend_request: ConversionPath
  vacancy_to_application: ConversionPath
  notification_to_action: NotificationAction[]
}

export function AdminAttribution() {
  const [data, setData] = useState<AttributionData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [windowHours, setWindowHours] = useState<WindowHours>(24)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getCrossFeatureAttribution(daysFilter, windowHours)
      setData(result)
    } catch (err) {
      logger.error('[AdminAttribution] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load attribution analytics')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, windowHours])

  useEffect(() => {
    document.title = 'Attribution | PLAYR Admin'
    fetchData()
  }, [fetchData])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load attribution analytics</h2>
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

  const profileToMessage = data?.profile_to_message
  const profileToFriend = data?.profile_to_friend_request
  const vacancyToApp = data?.vacancy_to_application
  const notificationActions = [...(data?.notification_to_action ?? [])].sort(
    (a, b) => b.clickers - a.clickers,
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cross-Feature Attribution</h1>
          <p className="text-sm text-gray-500 mt-1">
            How features drive conversions across the platform
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Day filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {([7, 30, 90] as DaysFilter[]).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setDaysFilter(d)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  daysFilter === d
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          {/* Window selector */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {([24, 48, 168] as WindowHours[]).map((w) => (
              <button
                type="button"
                key={w}
                onClick={() => setWindowHours(w)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  windowHours === w
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {WINDOW_LABELS[w]}
              </button>
            ))}
          </div>
          {/* Refresh */}
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
      </div>

      {/* Conversion Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 bg-gray-200 rounded" />
                <div className="w-4 h-4 bg-gray-200 rounded" />
                <div className="w-5 h-5 bg-gray-200 rounded" />
              </div>
              <div className="h-10 w-24 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-20 bg-gray-200 rounded mb-4" />
              <div className="h-3 w-32 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Profile View → Message */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-5 h-5 text-gray-400" />
              <ArrowRight className="w-4 h-4 text-gray-300" />
              <Mail className="w-5 h-5 text-gray-400" />
            </div>
            <div className="text-xs font-medium text-purple-600 uppercase tracking-wide mb-1">
              Profile View &rarr; Message
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {(profileToMessage?.conversion_rate ?? 0).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500 mt-1">conversion rate</div>
            <div className="mt-4 text-xs text-gray-400">
              {(profileToMessage?.total_profile_viewers ?? 0).toLocaleString()} viewers &rarr;{' '}
              {(profileToMessage?.converted_to_message ?? 0).toLocaleString()} converted
            </div>
          </div>

          {/* Profile View → Friend Request */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-5 h-5 text-gray-400" />
              <ArrowRight className="w-4 h-4 text-gray-300" />
              <UserPlus className="w-5 h-5 text-gray-400" />
            </div>
            <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
              Profile View &rarr; Friend Request
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {(profileToFriend?.conversion_rate ?? 0).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500 mt-1">conversion rate</div>
            <div className="mt-4 text-xs text-gray-400">
              {(profileToFriend?.total_profile_viewers ?? 0).toLocaleString()} viewers &rarr;{' '}
              {(profileToFriend?.converted_to_friend_request ?? 0).toLocaleString()} converted
            </div>
          </div>

          {/* Vacancy View → Application */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5 text-gray-400" />
              <ArrowRight className="w-4 h-4 text-gray-300" />
              <UserPlus className="w-5 h-5 text-gray-400" />
            </div>
            <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">
              Vacancy View &rarr; Application
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {(vacancyToApp?.conversion_rate ?? 0).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500 mt-1">conversion rate</div>
            <div className="mt-4 text-xs text-gray-400">
              {(vacancyToApp?.total_vacancy_viewers ?? 0).toLocaleString()} viewers &rarr;{' '}
              {(vacancyToApp?.converted_to_application ?? 0).toLocaleString()} converted
            </div>
          </div>
        </div>
      )}

      {/* Notification → Action Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Notification Click &rarr; Action Conversion
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Users who took an action within 1 hour of clicking a notification
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : notificationActions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No notification data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">
                    <Bell className="w-3.5 h-3.5 inline-block mr-1" />
                    Notification Kind
                  </th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Clickers</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Action Takers</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Action Rate</th>
                </tr>
              </thead>
              <tbody>
                {notificationActions.map((row) => (
                  <tr
                    key={row.kind}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                        {row.kind.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-gray-900">
                      {row.clickers.toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-gray-900">
                      {row.action_takers.toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-gray-900">
                      {row.action_rate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
