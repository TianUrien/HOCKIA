/**
 * AdminFeedAnalytics Page
 *
 * Feed & content analytics dashboard showing post creation, likes, comments,
 * and engagement across the platform.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  FileText,
  Heart,
  MessageCircle,
  Users,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getFeedAnalytics } from '../api/analyticsApi'
import type { FeedAnalytics } from '../types'
import { formatAdminDate } from '../utils/formatDate'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach: { bg: '#F0FDFA', text: '#0D9488' },
  club: { bg: '#FFF7ED', text: '#EA580C' },
  brand: { bg: '#FFF1F2', text: '#E11D48' },
}

export function AdminFeedAnalytics() {
  const [data, setData] = useState<FeedAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getFeedAnalytics(daysFilter)
      setData(result)
    } catch (err) {
      logger.error('[AdminFeedAnalytics] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load feed analytics')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Feed & Content | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Trend helpers
  const getTrend = (current: number, previous: number) => {
    const trendValue = current - previous
    const direction: 'up' | 'down' | 'neutral' =
      trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'neutral'
    return { value: trendValue, label: 'vs prev period', direction }
  }

  const summary = data?.summary ?? null

  // Chart calculations
  const dailyTrend = data?.daily_trend ?? []
  const maxDailyValue = Math.max(
    ...dailyTrend.map((d) => Math.max(d.posts, d.likes, d.comments)),
    1,
  )

  // Posts by role
  const postsByRole = data?.posts_by_role ?? []
  const maxRoleCount = Math.max(...postsByRole.map((r) => r.count), 1)

  // Post type breakdown
  const postTypes = summary
    ? [
        { label: 'User', count: summary.user_posts },
        { label: 'Transfer', count: summary.transfer_posts },
        { label: 'Signing', count: summary.signing_posts },
        { label: 'Brand', count: summary.brand_posts },
      ]
    : []
  const maxPostTypeCount = Math.max(...postTypes.map((t) => t.count), 1)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load feed analytics</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Feed & Content</h1>
          <p className="text-sm text-gray-500 mt-1">
            Post creation, likes, and comments across the platform
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Posts Created"
          value={summary?.total_posts ?? 0}
          icon={FileText}
          color="purple"
          loading={isLoading}
          trend={
            summary
              ? getTrend(summary.total_posts, summary.prev_total_posts)
              : undefined
          }
        />
        <StatCard
          label="Likes"
          value={summary?.total_likes ?? 0}
          icon={Heart}
          color="red"
          loading={isLoading}
          trend={
            summary
              ? getTrend(summary.total_likes, summary.prev_total_likes)
              : undefined
          }
        />
        <StatCard
          label="Comments"
          value={summary?.total_comments ?? 0}
          icon={MessageCircle}
          color="blue"
          loading={isLoading}
          trend={
            summary
              ? getTrend(summary.total_comments, summary.prev_total_comments)
              : undefined
          }
        />
        <StatCard
          label="Unique Authors"
          value={summary?.unique_authors ?? 0}
          icon={Users}
          color="green"
          loading={isLoading}
        />
      </div>

      {/* Two-column section: Daily Trend + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trend Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Daily Trend</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" /> Posts
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Likes
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" /> Comments
            </div>
          </div>

          {isLoading ? (
            <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
          ) : (
            <div className="h-48 flex items-end gap-0.5">
              {dailyTrend.map((day, index) => {
                const postsHeight = (day.posts / maxDailyValue) * 100
                const likesHeight = (day.likes / maxDailyValue) * 100
                const commentsHeight = (day.comments / maxDailyValue) * 100
                const isToday = index === dailyTrend.length - 1

                return (
                  <div
                    key={day.day}
                    className="flex-1 group relative flex items-end gap-px"
                    title={`${day.day}: ${day.posts} posts, ${day.likes} likes, ${day.comments} comments`}
                  >
                    <div
                      className={`flex-1 rounded-t transition-all ${
                        isToday ? 'bg-purple-600' : 'bg-purple-400 hover:bg-purple-500'
                      }`}
                      style={{ height: `${Math.max(postsHeight, 2)}%` }}
                    />
                    <div
                      className="flex-1 rounded-t bg-red-300 hover:bg-red-400 transition-all"
                      style={{ height: `${Math.max(likesHeight, 2)}%` }}
                    />
                    <div
                      className="flex-1 rounded-t bg-blue-300 hover:bg-blue-400 transition-all"
                      style={{ height: `${Math.max(commentsHeight, 2)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                      <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                        <div>{formatAdminDate(day.day)}</div>
                        <div>{day.posts} posts</div>
                        <div>{day.likes} likes</div>
                        <div>{day.comments} comments</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{dailyTrend[0]?.day ? formatAdminDate(dailyTrend[0].day) : ''}</span>
            <span>Today</span>
          </div>
        </div>

        {/* Posts by Role + Post Types */}
        <div className="space-y-6">
          {/* Posts by Role */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Posts by Role</h2>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {postsByRole.map((role) => {
                  const colors = ROLE_COLORS[role.role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }
                  const widthPct = (role.count / maxRoleCount) * 100

                  return (
                    <div key={role.role}>
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={{
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {role.role}
                        </span>
                        <span className="text-sm font-mono text-gray-600">
                          {role.count.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: colors.text,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
                {postsByRole.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No data available</p>
                )}
              </div>
            )}
          </div>

          {/* Post Types */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Post Types</h2>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {postTypes.map((pt) => {
                  const widthPct = (pt.count / maxPostTypeCount) * 100
                  return (
                    <div key={pt.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">{pt.label}</span>
                        <span className="text-sm font-mono text-gray-600">
                          {pt.count.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-purple-500 transition-all"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Posts Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Top Posts</h2>
        <p className="text-sm text-gray-500 mb-4">
          Most engaged posts in the last {daysFilter} days
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (data?.top_posts ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No posts found for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Author</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Content</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Type</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">
                    <Heart className="w-3.5 h-3.5 inline-block mr-1" />
                    Likes
                  </th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">
                    <MessageCircle className="w-3.5 h-3.5 inline-block mr-1" />
                    Comments
                  </th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {(data?.top_posts ?? []).map((post) => {
                  const colors = ROLE_COLORS[post.author_role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }

                  return (
                    <tr
                      key={post.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      {/* Author */}
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {post.author_avatar ? (
                            <img
                              src={post.author_avatar}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
                              <Users className="w-3.5 h-3.5 text-purple-600" />
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-gray-900 text-sm whitespace-nowrap">
                              {post.author_name}
                            </div>
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize"
                              style={{
                                backgroundColor: colors.bg,
                                color: colors.text,
                              }}
                            >
                              {post.author_role}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Content (truncated) */}
                      <td className="py-3 px-2">
                        <p className="text-gray-700 max-w-xs truncate" title={post.content}>
                          {post.content}
                        </p>
                      </td>

                      {/* Type */}
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                          {post.post_type}
                        </span>
                      </td>

                      {/* Likes */}
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {post.like_count.toLocaleString()}
                      </td>

                      {/* Comments */}
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {post.comment_count.toLocaleString()}
                      </td>

                      {/* Date */}
                      <td className="py-3 px-2 text-right text-gray-500 whitespace-nowrap">
                        {new Date(post.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
