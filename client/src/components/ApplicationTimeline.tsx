import { useEffect, useState } from 'react'
import { Send, Eye, CheckCircle, Clock, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { playerApplicationStatusBadge, applicationReasonPlayerCopy } from '@/lib/applicationStatus'

/**
 * Player-facing application timeline (Phase 3-5 of application-clarity).
 *
 * Shows, for the player's OWN application to this opportunity: when they applied,
 * whether/when the club viewed it (application_views), each status change
 * (application_status_history), and — for the current status — the kind AI
 * explanation from the application-feedback edge function. All reads are RLS-gated
 * to the applicant.
 *
 * Takes only `opportunityId` and resolves the application itself, so it works on
 * EVERY entry point (standalone page, home-feed overlay, opportunities list/tab) —
 * none of which reliably has the application id in hand. Degrades gracefully: a
 * failed AI fetch falls back to deterministic client copy; a failed history/views
 * fetch just omits that piece.
 */
interface HistoryRow {
  id: string
  new_status: string
  reason: string | null
  created_at: string
}

interface ApplicationTimelineProps {
  opportunityId: string
}

interface TimelineNode {
  key: string
  icon: typeof Send
  label: string
  date: string | null
  dotClass: string
  message?: string | null
}

const RESPONDED = ['shortlisted', 'maybe', 'rejected']

function statusDotClass(status: string): string {
  switch (status) {
    case 'shortlisted':
      return 'bg-emerald-500'
    case 'maybe':
      return 'bg-amber-500'
    case 'rejected':
      return 'bg-rose-400'
    default:
      return 'bg-gray-300'
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ApplicationTimeline({ opportunityId }: ApplicationTimelineProps) {
  const { user } = useAuthStore()
  const [currentStatus, setCurrentStatus] = useState<string | null>(null)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [firstViewedAt, setFirstViewedAt] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [resolved, setResolved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    setResolved(false)
    void (async () => {
      // Resolve the player's OWN application for this opportunity.
      const { data: app } = await supabase
        .from('opportunity_applications')
        .select('id, status, applied_at')
        .eq('opportunity_id', opportunityId)
        .eq('applicant_id', user.id)
        .maybeSingle()
      if (cancelled) return
      if (!app) {
        setLoading(false)
        return
      }
      const appId = app.id
      const status = (app.status as string | null) ?? null
      setResolved(true)
      setCurrentStatus(status)
      setAppliedAt(app.applied_at ?? null)

      const [historyRes, viewsRes] = await Promise.all([
        supabase
          .from('application_status_history')
          .select('id, new_status, reason, created_at')
          .eq('application_id', appId)
          .order('created_at', { ascending: true }),
        supabase
          .from('application_views')
          .select('first_viewed_at')
          .eq('application_id', appId)
          .order('first_viewed_at', { ascending: true })
          .limit(1),
      ])
      if (cancelled) return
      const hist = (historyRes.data ?? []) as HistoryRow[]
      setHistory(hist)
      setFirstViewedAt((viewsRes.data?.[0] as { first_viewed_at?: string } | undefined)?.first_viewed_at ?? null)
      setLoading(false)

      // AI explanation for the current status (only once the club has responded).
      if (!status || !RESPONDED.includes(status)) {
        setAiMessage(null)
        return
      }
      // The reason behind the most recent responded status — used for the
      // deterministic client fallback if the edge function is unreachable.
      const latestReason = [...hist].reverse().find((h) => playerApplicationStatusBadge(h.new_status))?.reason ?? null
      const fallback = applicationReasonPlayerCopy(latestReason)
      try {
        const { data, error } = await supabase.functions.invoke('application-feedback', {
          body: { application_id: appId },
        })
        if (cancelled) return
        if (error) {
          logger.warn('application-feedback invoke failed', error)
          setAiMessage(fallback)
          return
        }
        const msg = (data as { message?: string | null } | null)?.message
        setAiMessage(typeof msg === 'string' && msg.trim() ? msg : fallback)
      } catch (err) {
        if (!cancelled) {
          logger.warn('application-feedback error', err)
          setAiMessage(fallback)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [opportunityId, user])

  // No application resolved (e.g. not actually applied) → render nothing.
  if (!loading && !resolved) return null
  if (loading) {
    return <div className="mt-3 h-20 animate-pulse rounded-xl bg-gray-100" />
  }

  const responded = Boolean(currentStatus && RESPONDED.includes(currentStatus))

  const nodes: TimelineNode[] = []
  if (appliedAt) {
    nodes.push({ key: 'applied', icon: Send, label: 'You applied', date: appliedAt, dotClass: 'bg-[#8026FA]' })
  }
  if (firstViewedAt) {
    nodes.push({ key: 'viewed', icon: Eye, label: 'The club viewed your application', date: firstViewedAt, dotClass: 'bg-sky-400' })
  }
  const statusNodes = history.filter((h) => playerApplicationStatusBadge(h.new_status))
  statusNodes.forEach((h, i) => {
    const badge = playerApplicationStatusBadge(h.new_status)
    if (!badge) return
    const isLatest = i === statusNodes.length - 1
    nodes.push({
      key: h.id,
      icon: h.new_status === 'rejected' ? Clock : CheckCircle,
      label: badge.label,
      date: h.created_at,
      dotClass: statusDotClass(h.new_status),
      message: isLatest ? aiMessage : null,
    })
  })

  // Order dated nodes chronologically; the undated "awaiting" tail stays last.
  const dated = nodes
    .filter((n) => n.date)
    .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
  if (!responded) {
    dated.push({ key: 'awaiting', icon: Clock, label: "Awaiting the club's decision", date: null, dotClass: 'bg-gray-300' })
  }

  if (dated.length === 0) return null

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Your application</h4>
      <ol>
        {dated.map((node, idx) => {
          const Icon = node.icon
          const isLast = idx === dated.length - 1
          return (
            <li key={node.key} className="relative flex gap-3 pb-4 last:pb-0">
              {!isLast && <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-gray-200" aria-hidden />}
              <span className={`relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${node.dotClass}`}>
                <Icon className="h-3.5 w-3.5 text-white" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">{node.label}</span>
                  {node.date && <span className="flex-shrink-0 text-xs text-gray-400">{formatDate(node.date)}</span>}
                </div>
                {node.message && (
                  <p className="mt-1.5 flex gap-1.5 rounded-lg bg-white p-2.5 text-xs leading-relaxed text-gray-600 ring-1 ring-gray-100">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#8026FA]" />
                    <span>{node.message}</span>
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
