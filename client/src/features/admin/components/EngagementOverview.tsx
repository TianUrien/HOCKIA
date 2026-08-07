/**
 * EngagementOverview — the founder-readable analytics sections.
 *
 * Four rows below the KPI cards:
 *   1. Engagement    — DAU / WAU / MAU as absolute numbers with ⓘ explainers
 *   2. Growth        — New users, Activation rate, Profile completion (abs + %)
 *   3. Community     — Weekly contributors, Browsers vs Contributors, Content (7d)
 *   4. North Star    — the real-connection outcomes HOCKIA exists to create
 *
 * Every metric carries an <InfoTip> so the dashboard needs no analytics
 * background to read. Data: admin_get_engagement_overview + the existing
 * command-center stats (DAU/WAU/MAU/stickiness ride along from there).
 */

import { useEffect, useState } from 'react'
import { Image as ImageIcon, Video, FileText, Briefcase, MessagesSquare } from 'lucide-react'
import { InfoTip } from './InfoTip'
import { getEngagementOverview, type EngagementOverview as EngagementData } from '../api/adminApi'
import type { CommandCenterStats } from '../types'

interface EngagementOverviewProps {
  ccStats: CommandCenterStats | null
  days: number
  loading?: boolean
}

/** Shared card shell for all metric tiles in these sections. */
function MetricTile({
  label,
  info,
  value,
  sub,
  accent,
}: {
  label: string
  info: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: 'purple' | 'none'
}) {
  return (
    <div className={`rounded-xl border p-5 ${accent === 'purple' ? 'border-purple-200 bg-purple-50/40' : 'border-gray-200 bg-white'}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
        {info}
      </p>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      <span className="text-xs text-gray-400">{hint}</span>
    </div>
  )
}

function TileSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse">
      <div className="h-3 w-24 rounded bg-gray-200" />
      <div className="mt-2 h-7 w-16 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-28 rounded bg-gray-100" />
    </div>
  )
}

export function EngagementOverview({ ccStats, days, loading }: EngagementOverviewProps) {
  const [data, setData] = useState<EngagementData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setDataLoading(true)
    getEngagementOverview(days)
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setDataLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const isLoading = loading || dataLoading

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <TileSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <TileSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  const dau = ccStats?.dau ?? 0
  const wau = ccStats?.wau ?? 0
  const mau = ccStats?.mau ?? 0
  // Single source for the WAU/MAU ratio: the command-center RPC. Computing
  // it client-side too risked showing two slightly different roundings of
  // the same number on one page.
  const stickiness = ccStats?.wau_mau_ratio ?? 0

  const browsers = Math.max(0, (data?.wau ?? wau) - (data?.contributors_7d ?? 0))
  const contributorPct = data?.contributor_pct ?? 0
  const browserPct = Math.round((100 - contributorPct) * 10) / 10

  const newUsersDelta = (data?.new_users_period ?? 0) - (data?.new_users_prev ?? 0)

  const content = data?.content_7d
  const ns = data?.north_star

  return (
    <div className="space-y-3">
      {/* ── 1. ENGAGEMENT ─────────────────────────────────────────────── */}
      <SectionHeading title="Engagement" hint="who is actually using HOCKIA" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricTile
          label="Daily Active Users"
          info={<InfoTip metric="dau" interpretation={`${dau} people used HOCKIA today. For a weekly-rhythm sport, daily spikes matter less than the weekly habit.`} />}
          value={dau.toLocaleString()}
          sub="active today"
        />
        <MetricTile
          label="Weekly Active Users"
          info={<InfoTip metric="wau" interpretation={`${wau} people were active this week — ${stickiness}% of everyone active this month came back within 7 days.`} />}
          value={wau.toLocaleString()}
          sub={`${stickiness}% of monthly actives returned this week`}
        />
        <MetricTile
          label="Monthly Active Users"
          info={<InfoTip metric="mau" interpretation={`${mau} distinct people used HOCKIA in the last 30 days — the product's current reach.`} />}
          value={mau.toLocaleString()}
          sub="active in the last 30 days"
        />
      </div>

      {/* ── 2. GROWTH & ACTIVATION ────────────────────────────────────── */}
      <SectionHeading title="Growth & Activation" hint="new members, and whether they become real ones" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricTile
          label={`New Users (${days}d)`}
          info={<InfoTip metric="newUsers" interpretation={`${data?.new_users_period ?? 0} people joined in the last ${days} days, vs ${data?.new_users_prev ?? 0} in the previous ${days} — growth separated from engagement.`} />}
          value={`+${(data?.new_users_period ?? 0).toLocaleString()}`}
          sub={
            <span className={newUsersDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}>
              {newUsersDelta >= 0 ? '+' : ''}{newUsersDelta} vs previous {days}d
            </span>
          }
        />
        <MetricTile
          label="Activation Rate"
          info={<InfoTip metric="activation" value={data?.activation_pct} interpretation={`Of the ${data?.activation_cohort ?? 0} people who joined in the last ${days} days, ${data?.activation_activated ?? 0} completed onboarding, added a photo and set their position — ready to be found and contacted.`} />}
          value={`${data?.activation_pct ?? 0}%`}
          sub={`${data?.activation_activated ?? 0} / ${data?.activation_cohort ?? 0} new users activated`}
        />
        <MetricTile
          label="Profile Completion"
          info={<InfoTip metric="profileCompletion" value={data?.profile_completion_pct} interpretation={`${data?.profiles_complete ?? 0} of ${data?.profiles_total ?? 0} members have a photo and bio. Every incomplete profile is invisible to recruiters and Hockia AI.`} />}
          value={`${data?.profiles_complete ?? 0} / ${data?.profiles_total ?? 0}`}
          sub={`${data?.profile_completion_pct ?? 0}% of all members`}
        />
      </div>

      {/* ── 3. COMMUNITY & CONTENT ────────────────────────────────────── */}
      <SectionHeading title="Community & Content" hint="participation, not just presence" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="Weekly Contributors"
          info={<InfoTip metric="contributors" interpretation={`${data?.contributors_7d ?? 0} people created something in the last 7 days — posts, photos, videos, comments, messages or opportunities.`} />}
          value={(data?.contributors_7d ?? 0).toLocaleString()}
          sub={`of ${data?.wau ?? wau} weekly actives`}
        />
        <MetricTile
          label="Browsers vs Contributors"
          info={<InfoTip metric="contributorShare" value={contributorPct} interpretation={`${browserPct}% of this week's actives only consumed content, ${contributorPct}% created it (${browsers} browsers, ${data?.contributors_7d ?? 0} contributors). Healthy communities sit anywhere above the 90-9-1 rule.`} />}
          value={
            <span>
              {browserPct}% <span className="text-base font-medium text-gray-400">browse</span>{' '}
              · {contributorPct}% <span className="text-base font-medium text-gray-400">create</span>
            </span>
          }
          sub={
            <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <span className="h-full bg-gray-300" style={{ width: `${browserPct}%` }} />
              <span className="h-full bg-purple-500" style={{ width: `${contributorPct}%` }} />
            </span>
          }
        />
        <MetricTile
          label="Content Created (7d)"
          info={<InfoTip metric="contentCreation" interpretation="Fresh content this week — what members will find when they come back." />}
          value={
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-semibold text-gray-800">
              <span className="flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5 text-gray-400" />{content?.photos ?? 0} photos</span>
              <span className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 text-gray-400" />{content?.videos ?? 0} videos</span>
              <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-gray-400" />{content?.posts ?? 0} posts</span>
              <span className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5 text-gray-400" />{content?.opportunities ?? 0} opps</span>
            </div>
          }
          sub={`+ ${content?.comments ?? 0} comments · ${content?.messages ?? 0} messages`}
        />
      </div>

      {/* ── 4. NORTH STAR — REAL CONNECTIONS ──────────────────────────── */}
      <SectionHeading title="North Star — Real Connections" hint="the outcomes HOCKIA exists to create" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          accent="purple"
          label="Players Contacted"
          info={<InfoTip metric="playersContacted" interpretation={`${ns?.players_contacted ?? 0} players were contacted first by a club or coach in the last ${days} days (${ns?.club_conversations ?? 0} conversations started).`} />}
          value={ns?.players_contacted ?? 0}
          sub={`${ns?.club_conversations ?? 0} club-started chats`}
        />
        <MetricTile
          accent="purple"
          label="Applications"
          info={<InfoTip metric="applications" interpretation={`${ns?.applications ?? 0} applications submitted to real opportunities in the last ${days} days.`} />}
          value={ns?.applications ?? 0}
          sub={`last ${days} days`}
        />
        <MetricTile
          accent="purple"
          label="Shortlists"
          info={<InfoTip metric="shortlists" interpretation={`Clubs shortlisted ${ns?.shortlists ?? 0} applicants in the last ${days} days — the strongest pre-hire signal.`} />}
          value={ns?.shortlists ?? 0}
          sub={`last ${days} days`}
        />
        <MetricTile
          accent="purple"
          label="Club Invites"
          info={<InfoTip metric="invites" interpretation={`Clubs created ${ns?.invites_sent ?? 0} invite links in the last ${days} days; ${ns?.invite_joins ?? 0} members have joined through invite links.`} />}
          value={ns?.invites_sent ?? 0}
          sub={`${ns?.invite_joins ?? 0} joins via invites`}
        />
        <MetricTile
          accent="purple"
          label="Opportunities Filled"
          info={<InfoTip metric="filled" interpretation={`${ns?.filled_period ?? 0} positions filled in the last ${days} days (${ns?.filled_all_time ?? 0} all-time). This is the end of the funnel everything else feeds.`} />}
          value={ns?.filled_period ?? 0}
          sub={`${ns?.filled_all_time ?? 0} all-time`}
        />
      </div>

      <p className="flex items-center gap-2 text-[11px] text-gray-400">
        <MessagesSquare className="h-3 w-3" />
        Hover any ⓘ for what a metric means, how it’s calculated, and how HOCKIA compares to industry benchmarks.
      </p>
    </div>
  )
}
