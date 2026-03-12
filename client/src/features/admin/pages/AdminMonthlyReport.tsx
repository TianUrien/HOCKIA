/**
 * AdminMonthlyReport Page
 *
 * Monthly platform snapshot: growth, engagement, opportunities, social,
 * content, feature adoption, and email metrics. Shows current month
 * vs. previous month with percentage deltas.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Users,
  UserPlus,
  Activity,
  Briefcase,
  MessageCircle,
  Heart,
  Sparkles,
  Mail,
  TrendingUp,
  TrendingDown,
  Minus,
  UserCheck,
} from 'lucide-react'
import { getMonthlyReport } from '../api/adminApi'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { logger } from '@/lib/logger'
import type { MonthlyReportData, MonthlyMetrics } from '../types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pctChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return 100
  return Math.round(((current - previous) / previous) * 100)
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = pctChange(current, previous)
  if (delta === null) return <span className="text-xs text-gray-400">—</span>

  const isPositive = delta > 0
  const isNeutral = delta === 0

  if (isNeutral) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-gray-500">
        <Minus className="w-3 h-3" /> 0%
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
      isPositive ? 'text-emerald-600' : 'text-red-500'
    }`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isPositive ? '+' : ''}{delta}%
    </span>
  )
}

interface MetricRowProps {
  label: string
  current: number
  previous: number
  format?: 'number' | 'minutes' | 'percent'
}

function MetricRow({ label, current, previous, format = 'number' }: MetricRowProps) {
  const formatValue = (v: number) => {
    if (format === 'minutes') return `${v.toLocaleString()}m`
    if (format === 'percent') return `${v}%`
    return v.toLocaleString()
  }

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-b-0">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatValue(current)}</span>
        <span className="text-xs text-gray-400 tabular-nums w-16 text-right">{formatValue(previous)}</span>
        <div className="w-16 text-right">
          <DeltaBadge current={current} previous={previous} />
        </div>
      </div>
    </div>
  )
}

interface SectionCardProps {
  title: string
  icon: React.ElementType
  iconColor: string
  children: React.ReactNode
}

function SectionCard({ title, icon: Icon, iconColor, children }: SectionCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColor}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <div className="ml-auto flex items-center gap-6 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
          <span>Current</span>
          <span>Prev</span>
          <span className="w-16 text-right">Change</span>
        </div>
      </div>
      <div className="px-5 py-1">
        {children}
      </div>
    </div>
  )
}

export function AdminMonthlyReport() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<MonthlyReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const report = await getMonthlyReport(year, month)
      setData(report)
    } catch (err) {
      logger.error('[AdminMonthlyReport] Failed to fetch:', err)
      reportSupabaseError('admin.monthly_report', err, { year, month })
      setError(err instanceof Error ? err.message : 'Failed to load monthly report')
    } finally {
      setIsLoading(false)
    }
  }, [year, month])

  useEffect(() => {
    document.title = `${MONTH_NAMES[month - 1]} ${year} Report | PLAYR Admin`
    fetchData()
  }, [fetchData, month, year])

  const goToPrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  const goToNextMonth = () => {
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
    if (isCurrentMonth) return
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-purple-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button onClick={fetchData} className="text-sm text-red-700 underline">Retry</button>
      </div>
    )
  }

  if (!data) return null

  const c: MonthlyMetrics = data.current
  const p: MonthlyMetrics = data.previous

  const onboardingRate = c.new_signups > 0 ? Math.round((c.onboarding_completed / c.new_signups) * 100) : 0
  const prevOnboardingRate = p.new_signups > 0 ? Math.round((p.onboarding_completed / p.new_signups) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Platform snapshot — {MONTH_NAMES[month - 1]} {year} vs. {month === 1 ? MONTH_NAMES[11] : MONTH_NAMES[month - 2]} {month === 1 ? year - 1 : year}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg min-w-[140px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={fetchData}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors ml-2"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'New Users', value: c.new_signups, prev: p.new_signups, icon: UserPlus, color: 'bg-purple-500' },
          { label: 'Monthly Active Users', value: c.mau, prev: p.mau, icon: Users, color: 'bg-blue-500' },
          { label: 'Applications', value: c.applications_submitted, prev: p.applications_submitted, icon: Briefcase, color: 'bg-emerald-500' },
          { label: 'Messages Sent', value: c.messages_sent, prev: p.messages_sent, icon: MessageCircle, color: 'bg-orange-500' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${kpi.color}`}>
                <kpi.icon className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-medium text-gray-500">{kpi.label}</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold text-gray-900 tabular-nums">{kpi.value.toLocaleString()}</span>
              <DeltaBadge current={kpi.value} previous={kpi.prev} />
            </div>
          </div>
        ))}
      </div>

      {/* Sections grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Growth */}
        <SectionCard title="Growth" icon={UserPlus} iconColor="bg-purple-500">
          <MetricRow label="Total signups" current={c.new_signups} previous={p.new_signups} />
          <MetricRow label="Players" current={c.new_players} previous={p.new_players} />
          <MetricRow label="Coaches" current={c.new_coaches} previous={p.new_coaches} />
          <MetricRow label="Clubs" current={c.new_clubs} previous={p.new_clubs} />
          <MetricRow label="Brands" current={c.new_brands} previous={p.new_brands} />
          <MetricRow label="Onboarding completed" current={c.onboarding_completed} previous={p.onboarding_completed} />
          <MetricRow label="Onboarding rate" current={onboardingRate} previous={prevOnboardingRate} format="percent" />
          <MetricRow label="Cumulative users" current={c.total_users} previous={p.total_users} />
        </SectionCard>

        {/* Engagement */}
        <SectionCard title="Engagement" icon={Activity} iconColor="bg-blue-500">
          <MetricRow label="Monthly Active Users" current={c.mau} previous={p.mau} />
          <MetricRow label="Avg Daily Active Users" current={c.avg_dau} previous={p.avg_dau} />
          <MetricRow label="Returning users" current={c.returning_users} previous={p.returning_users} />
          <MetricRow label="Total sessions" current={c.total_sessions} previous={p.total_sessions} />
          <MetricRow label="Total time on platform" current={c.total_minutes} previous={p.total_minutes} format="minutes" />
          <MetricRow label="Avg session duration" current={c.avg_session_minutes} previous={p.avg_session_minutes} format="minutes" />
        </SectionCard>

        {/* Opportunities */}
        <SectionCard title="Opportunities Pipeline" icon={Briefcase} iconColor="bg-emerald-500">
          <MetricRow label="Opportunities created" current={c.opportunities_created} previous={p.opportunities_created} />
          <MetricRow label="Opportunities closed" current={c.opportunities_closed} previous={p.opportunities_closed} />
          <MetricRow label="Applications submitted" current={c.applications_submitted} previous={p.applications_submitted} />
          <MetricRow label="Unique applicants" current={c.unique_applicants} previous={p.unique_applicants} />
        </SectionCard>

        {/* Social & Trust */}
        <SectionCard title="Social & Trust" icon={UserCheck} iconColor="bg-teal-500">
          <MetricRow label="Messages sent" current={c.messages_sent} previous={p.messages_sent} />
          <MetricRow label="Active conversations" current={c.active_conversations} previous={p.active_conversations} />
          <MetricRow label="Friend requests" current={c.friend_requests_sent} previous={p.friend_requests_sent} />
          <MetricRow label="Friendships formed" current={c.friendships_accepted} previous={p.friendships_accepted} />
          <MetricRow label="References requested" current={c.references_requested} previous={p.references_requested} />
          <MetricRow label="References accepted" current={c.references_accepted} previous={p.references_accepted} />
        </SectionCard>

        {/* Content */}
        <SectionCard title="Content" icon={Heart} iconColor="bg-rose-500">
          <MetricRow label="Posts created" current={c.posts_created} previous={p.posts_created} />
          <MetricRow label="Comments" current={c.comments_created} previous={p.comments_created} />
          <MetricRow label="Likes" current={c.likes_given} previous={p.likes_given} />
          <MetricRow label="Media uploads" current={c.media_uploads} previous={p.media_uploads} />
          <MetricRow label="Community questions" current={c.community_questions} previous={p.community_questions} />
          <MetricRow label="Community answers" current={c.community_answers} previous={p.community_answers} />
        </SectionCard>

        {/* Feature Adoption */}
        <SectionCard title="Feature Adoption" icon={Sparkles} iconColor="bg-amber-500">
          <MetricRow label="Discovery queries" current={c.discovery_queries} previous={p.discovery_queries} />
          <MetricRow label="Discovery users" current={c.discovery_users} previous={p.discovery_users} />
          <MetricRow label="Brand posts published" current={c.brand_posts_published} previous={p.brand_posts_published} />
          <MetricRow label="Brand followers gained" current={c.brand_followers_gained} previous={p.brand_followers_gained} />
        </SectionCard>

        {/* Email */}
        <SectionCard title="Email" icon={Mail} iconColor="bg-sky-500">
          <MetricRow label="Emails sent" current={c.emails_sent} previous={p.emails_sent} />
          <MetricRow label="Open rate" current={c.email_open_rate} previous={p.email_open_rate} format="percent" />
          <MetricRow label="Click rate" current={c.email_click_rate} previous={p.email_click_rate} format="percent" />
        </SectionCard>
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-400 text-center">
        Data excludes test accounts. Engagement metrics use heartbeat tracking. Generated at {data.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}.
      </p>
    </div>
  )
}
