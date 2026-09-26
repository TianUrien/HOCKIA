import { useEffect, useState } from 'react'
import { Send, Eye, CheckCircle, CircleDot, Clock, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { playerApplicationStatusBadge, applicationStatusFallbackMessage, applicationStatusLabel } from '@/lib/applicationStatus'
import { clubNoteFromFeedback } from '@/lib/opportunityCopy'

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
  /** Who wrote `message`: the AI explanation (sparkle), the club's own
   *  decline note (plain "The club's note"), or fixed copy (plain). */
  messageKind?: MessageKind
  subtext?: string | null
}

type MessageKind = 'ai' | 'club' | 'plain'

// 'no_response' and 'filled' are terminal like a response (they render a
// status node), but no AI pass exists for them: no_response comes from the
// auto-expiry sweep, filled from the club closing the role.
const RESPONDED = ['shortlisted', 'maybe', 'rejected', 'no_response', 'filled']
const DETERMINISTIC = ['no_response', 'filled']
const FINAL_OUTCOMES = ['rejected', 'no_response', 'filled']

function statusDotClass(status: string): string {
  switch (status) {
    case 'shortlisted':
      return 'bg-emerald-500'
    // Amber only when the viewer must act soon (founder 2026-09-26): the
    // player can't act on "Replied", so it's neutral grey too.
    case 'maybe':
    case 'rejected':
    case 'no_response':
    case 'filled':
      // "Not selected" is grey, not an error colour (founder ruling 2026-09-25).
      return 'bg-gray-400'
    default:
      return 'bg-gray-300'
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Response-deadline config (Task 3b): single-row, publicly readable, cached per
// session. Disabled sweep / NULL launch_date → feature dark, no deadline shown.
let responseSettingsCache:
  | { launch_date: string | null; expiry_days: number; sweep_enabled: boolean }
  | null
  | undefined
async function fetchResponseSettings() {
  if (responseSettingsCache !== undefined) return responseSettingsCache
  const { data } = await supabase
    .from('application_response_settings')
    .select('launch_date, expiry_days, sweep_enabled')
    .maybeSingle()
  responseSettingsCache = data ?? null
  return responseSettingsCache
}

export default function ApplicationTimeline({ opportunityId }: ApplicationTimelineProps) {
  const { user } = useAuthStore()
  const [currentStatus, setCurrentStatus] = useState<string | null>(null)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [firstViewedAt, setFirstViewedAt] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<MessageKind>('ai')
  const [deadline, setDeadline] = useState<string | null>(null)
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
        .select('id, status, applied_at, ai_feedback')
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

      // Bounded waiting: while pending, show when the sweep will close this
      // application — GREATEST(applied_at, launch_date) + expiry_days, the
      // exact server-side clock (grandfathering included).
      if (status === 'pending' && app.applied_at) {
        const settings = await fetchResponseSettings()
        if (cancelled) return
        if (settings?.sweep_enabled && settings.launch_date) {
          const start = Math.max(
            new Date(app.applied_at).getTime(),
            new Date(settings.launch_date).getTime(),
          )
          setDeadline(new Date(start + settings.expiry_days * 86_400_000).toISOString())
        }
      } else {
        setDeadline(null)
      }

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
      // A decline note the club wrote itself is shown as the club's words,
      // never dressed up as AI (same rule as the phone card).
      const clubNote = clubNoteFromFeedback((app as { ai_feedback?: unknown }).ai_feedback, status)
      if (clubNote) {
        setMessageKind('club')
        setAiMessage(clubNote)
        return
      }
      if (DETERMINISTIC.includes(status)) {
        // application-feedback only explains real club responses; the
        // deterministic copy IS the message for auto-expiries and filled roles.
        setMessageKind('plain')
        setAiMessage(applicationStatusFallbackMessage(status, null))
        return
      }
      // The reason behind the most recent responded status — used for the
      // deterministic client fallback if the edge function is unreachable.
      const latestReason = [...hist].reverse().find((h) => playerApplicationStatusBadge(h.new_status))?.reason ?? null
      const fallback = applicationStatusFallbackMessage(status, latestReason)
      try {
        const { data, error } = await supabase.functions.invoke('application-feedback', {
          body: { application_id: appId },
        })
        if (cancelled) return
        if (error) {
          logger.warn('application-feedback invoke failed', error)
          setMessageKind('plain')
          setAiMessage(fallback)
          return
        }
        const msg = (data as { message?: string | null } | null)?.message
        const hasMsg = typeof msg === 'string' && msg.trim()
        setMessageKind(hasMsg ? 'ai' : 'plain')
        setAiMessage(hasMsg ? msg : fallback)
      } catch (err) {
        if (!cancelled) {
          logger.warn('application-feedback error', err)
          setMessageKind('plain')
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

  // Fixed NARRATIVE order: Applied → club viewed → CURRENT status. We deliberately
  // show ONLY the current status (the most recent responded change), never the full
  // history: a club that revised its decision must not show the player a stack of
  // contradictory outcomes (e.g. "Shortlisted" AND "Not selected"), and an
  // improving/declining trail reads as unkind. The "viewed" milestone is pinned
  // after "Applied" rather than sorted by timestamp so it never lands below the
  // outcome (clubs sometimes re-open a profile after deciding).
  const currentStatusRow = [...history].reverse().find((h) => playerApplicationStatusBadge(h.new_status))

  const nodes: TimelineNode[] = []
  if (appliedAt) {
    nodes.push({ key: 'applied', icon: Send, label: 'You applied', date: appliedAt, dotClass: 'bg-hockia-primary' })
  }
  if (firstViewedAt) {
    nodes.push({ key: 'viewed', icon: Eye, label: 'The club viewed your application', date: firstViewedAt, dotClass: 'bg-sky-400' })
  }
  if (responded && currentStatus) {
    const badge = playerApplicationStatusBadge(currentStatus)
    if (badge) {
      nodes.push({
        key: 'status',
        // A final outcome is not a wait: neutral dot, never a Clock.
        icon: FINAL_OUTCOMES.includes(currentStatus) ? CircleDot : CheckCircle,
        label: badge.label,
        date: currentStatusRow?.created_at ?? null,
        dotClass: statusDotClass(currentStatus),
        message: aiMessage,
        messageKind,
      })
    }
  } else if (!responded) {
    nodes.push({
      key: 'awaiting',
      icon: Clock,
      label: applicationStatusLabel('pending') ?? 'In review',
      date: null,
      dotClass: 'bg-gray-300',
      subtext: deadline ? `The club has until ${formatDate(deadline)} to respond.` : null,
    })
  }

  if (nodes.length === 0) return null

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Your application</h4>
      <ol>
        {nodes.map((node, idx) => {
          const Icon = node.icon
          const isLast = idx === nodes.length - 1
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
                {node.subtext && <p className="mt-1 text-xs text-gray-500">{node.subtext}</p>}
                {node.message && node.messageKind === 'club' ? (
                  <div className="mt-1.5 rounded-lg bg-white p-2.5 ring-1 ring-gray-100" data-testid="timeline-club-note">
                    <p className="text-xs font-semibold text-gray-500">The club’s note</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700">{node.message}</p>
                  </div>
                ) : node.message ? (
                  <p className="mt-1.5 flex gap-1.5 rounded-lg bg-white p-2.5 text-xs leading-relaxed text-gray-600 ring-1 ring-gray-100" data-testid="timeline-message">
                    {node.messageKind !== 'plain' && (
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-hockia-primary" data-testid="timeline-ai-sparkle" />
                    )}
                    <span>{node.message}</span>
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
