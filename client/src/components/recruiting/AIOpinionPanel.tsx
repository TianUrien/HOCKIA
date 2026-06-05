/**
 * AIOpinionPanel — recruiter-facing LLM verdict on player↔club fit.
 *
 * Section F (G.7) Phase 1 surface. Mounts on the public profile's
 * ScoutingCard for recruiter viewers when:
 *   - VITE_ENABLE_AI_OPINION is enabled
 *   - viewer.role is club/coach
 *   - useClubFit(candidate).isApplicable === true (recruiting target
 *     resolves; same gate as ClubFitChip)
 *   - candidate is NOT the viewer
 *
 * Stays hidden in every other case. No skeleton for non-applicable
 * states — we don't want a placeholder pulling visual weight when
 * Fit doesn't apply.
 *
 * Visual: compact card sitting under Zone 1 of ScoutingCard. One-line
 * verdict + collapsible citations. "Regenerate" action visible only
 * when status=ready (no point regenerating an error). Quota counter
 * shown subtly so recruiters see they have a soft cap.
 */

import { useEffect, useState } from 'react'
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
  AlertCircle,
  Clock,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { useAIOpinion } from '@/hooks/useAIOpinion'
import type { AIOpinionFeedbackRating, AIOpinionCandidate } from '@/hooks/useAIOpinion'
import {
  trackAIOpinionViewed,
  trackAIOpinionRegenerated,
  trackAIOpinionFeedbackSubmitted,
  trackAIOpinionQuotaExceeded,
  trackAIOpinionError,
} from '@/lib/analytics'

interface AIOpinionPanelProps {
  candidate: AIOpinionCandidate
  className?: string
}

/** Read the build/runtime flag inside the function so vitest can
 *  stub it via `vi.stubEnv('VITE_ENABLE_AI_OPINION', 'true')` after
 *  the module is imported. In prod, Vite replaces `import.meta.env.X`
 *  at build time with a literal, so this stays a dead-code-elimination-
 *  friendly check — the function body is gone from the bundle when
 *  the flag is unset at build. */
function isFeatureEnabled(): boolean {
  return (import.meta.env.VITE_ENABLE_AI_OPINION ?? '').toString().toLowerCase() === 'true'
}

export default function AIOpinionPanel({ candidate, className = '' }: AIOpinionPanelProps) {
  const featureEnabled = isFeatureEnabled()
  const { status, regenerate, submitFeedback } = useAIOpinion(candidate, { enabled: featureEnabled })
  const [citationsOpen, setCitationsOpen] = useState(false)
  // Phase 2 Slice A: feedback state. `rating` is the rating this
  // session has submitted (filled icon for visual confirmation).
  // `reasonOpen` controls the textarea visibility — appears after a
  // thumbs-down click so the user can optionally elaborate. The down
  // vote itself is persisted immediately so the negative signal isn't
  // lost if they navigate away before typing.
  const [rating, setRating] = useState<AIOpinionFeedbackRating | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonText, setReasonText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset feedback state whenever the underlying opinion changes
  // (Regenerate → new opinionId). Otherwise the prior rating would
  // visually carry over to a different verdict.
  const opinionId = status.kind === 'ready' ? status.opinionId : null
  useEffect(() => {
    setRating(null)
    setReasonOpen(false)
    setReasonText('')
  }, [opinionId])

  // GA4: viewed event fires once per (panel instance, opinion_id).
  // opinionId-keyed so a Regenerate-driven new verdict produces a
  // second 'viewed' event (correctly — it IS a new verdict to view).
  // The cached vs fresh distinction in the label lets us see cache
  // hit rates over time.
  const opinionCached = status.kind === 'ready' ? status.cached : null
  const opinionQuotaRemaining = status.kind === 'ready' ? status.quotaRemaining : null
  useEffect(() => {
    if (opinionId && opinionCached !== null) {
      trackAIOpinionViewed(opinionCached, opinionQuotaRemaining)
    }
  }, [opinionId, opinionCached, opinionQuotaRemaining])

  // GA4: terminal-error state events. Fire once per transition into
  // each status (not on every re-render while the status is stuck).
  const statusKind = status.kind
  useEffect(() => {
    if (statusKind === 'quota_exceeded') trackAIOpinionQuotaExceeded()
    else if (statusKind === 'error') trackAIOpinionError()
  }, [statusKind])

  const handleRegenerate = () => {
    trackAIOpinionRegenerated()
    void regenerate()
  }

  const handleRating = async (next: AIOpinionFeedbackRating) => {
    if (submitting) return
    setSubmitting(true)
    setRating(next)
    if (next === 'down') setReasonOpen(true)
    else setReasonOpen(false)
    try {
      await submitFeedback(next, null)
      // Track AFTER the write succeeds so analytics doesn't over-count
      // failed submits. has_reason=false here — reason flow fires its
      // own event when Send is clicked.
      trackAIOpinionFeedbackSubmitted(next, false)
    } catch {
      // Hook already logged. Roll back UI state so user can retry.
      setRating(null)
      setReasonOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReasonSubmit = async () => {
    if (submitting || !rating) return
    setSubmitting(true)
    try {
      await submitFeedback(rating, reasonText)
      trackAIOpinionFeedbackSubmitted(rating, reasonText.trim().length > 0)
      setReasonOpen(false)
    } catch {
      // Keep the textarea open so the user can retry.
    } finally {
      setSubmitting(false)
    }
  }

  // Hide entirely when the flag is off OR Fit doesn't apply. We never
  // want to teach recruiters that "AI opinion exists for some players
  // but not others" — gated invisibly so the surface stays consistent
  // with how ClubFitChip behaves.
  if (!featureEnabled) return null
  if (status.kind === 'idle' || status.kind === 'not_applicable') return null

  return (
    <section
      className={[
        'rounded-xl border border-[#8026FA]/20 bg-gradient-to-br from-[#8026FA]/[0.04] to-[#924CEC]/[0.04] p-4',
        className,
      ].join(' ')}
      data-testid="ai-opinion-panel"
      aria-label="HOCKIA AI fit opinion"
      aria-busy={status.kind === 'loading'}
    >
      <header className="flex items-start gap-2.5 mb-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-[#8026FA] shadow-sm">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8026FA]">
            HOCKIA AI · fit opinion
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Private to you. Based on the player's profile facts vs your team scope.
          </p>
        </div>
      </header>

      {status.kind === 'loading' && (
        <div className="space-y-2 mt-2" aria-busy="true" aria-live="polite">
          <div className="h-3 bg-gray-100 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
        </div>
      )}

      {status.kind === 'error' && (
        <div className="mt-2 flex items-start gap-2 text-sm text-gray-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p>Couldn't load the opinion right now.</p>
            <button
              type="button"
              onClick={() => void regenerate()}
              className="mt-1 text-xs font-medium text-[#8026FA] hover:text-[#6B20D4]"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {status.kind === 'quota_exceeded' && (
        <div className="mt-2 flex items-start gap-2 text-sm text-gray-700">
          <Clock className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p>Daily AI opinion limit reached (50/day).</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Resets at midnight UTC. Cached opinions still available without a fresh call.
            </p>
          </div>
        </div>
      )}

      {status.kind === 'ready' && (
        <>
          <p
            className="text-sm text-gray-900 leading-snug"
            data-testid="ai-opinion-verdict"
          >
            {status.data.verdict_short}
          </p>

          {status.data.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#8026FA]/10">
              <button
                type="button"
                onClick={() => setCitationsOpen((open) => !open)}
                aria-expanded={citationsOpen ? 'true' : 'false'}
                aria-controls="ai-opinion-citations"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8026FA] hover:text-[#6B20D4]"
              >
                {citationsOpen ? 'Hide evidence' : `Why · ${status.data.citations.length} citation${status.data.citations.length === 1 ? '' : 's'}`}
                {citationsOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>

              {citationsOpen && (
                <ul
                  id="ai-opinion-citations"
                  className="mt-2.5 space-y-1.5"
                  data-testid="ai-opinion-citations"
                >
                  {status.data.citations.map((c, i) => (
                    <li
                      key={`${c.field}-${i}`}
                      className="text-xs text-gray-700 leading-snug"
                    >
                      <span className="font-mono text-[10px] text-[#8026FA] mr-1.5">
                        {c.field}
                      </span>
                      {c.claim}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <footer className="mt-3 pt-2 border-t border-[#8026FA]/10 flex items-center justify-between text-[10px] text-gray-500">
            <span>
              {status.cached ? 'Cached' : 'Fresh'}
              {status.quotaRemaining !== null && !status.cached && (
                <span className="ml-1">· {status.quotaRemaining} fresh remaining today</span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {status.opinionId && (
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label="Rate this opinion"
                  data-testid="ai-opinion-feedback"
                >
                  <button
                    type="button"
                    onClick={() => void handleRating('up')}
                    disabled={submitting}
                    aria-pressed={rating === 'up' ? 'true' : 'false'}
                    aria-label="Helpful"
                    title="Helpful"
                    className={[
                      'inline-flex h-5 w-5 items-center justify-center rounded-full transition',
                      rating === 'up'
                        ? 'bg-[#8026FA]/15 text-[#8026FA]'
                        : 'text-gray-400 hover:text-[#8026FA] hover:bg-[#8026FA]/10',
                      submitting ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRating('down')}
                    disabled={submitting}
                    aria-pressed={rating === 'down' ? 'true' : 'false'}
                    aria-label="Not helpful"
                    title="Not helpful"
                    className={[
                      'inline-flex h-5 w-5 items-center justify-center rounded-full transition',
                      rating === 'down'
                        ? 'bg-amber-100 text-amber-700'
                        : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50',
                      submitting ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={handleRegenerate}
                className="inline-flex items-center gap-1 font-medium text-[#8026FA] hover:text-[#6B20D4]"
                title="Regenerate the opinion (counts against your daily quota if not cached)"
              >
                <RefreshCcw className="h-3 w-3" />
                Regenerate
              </button>
            </div>
          </footer>

          {reasonOpen && rating === 'down' && (
            <div
              className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5"
              data-testid="ai-opinion-feedback-reason"
            >
              <label
                htmlFor="ai-opinion-feedback-reason-input"
                className="block text-[10px] font-semibold text-amber-800"
              >
                What was off? (optional)
              </label>
              <textarea
                id="ai-opinion-feedback-reason-input"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="e.g. the level comparison was inverted, or it missed a key fact…"
                className="mt-1 w-full resize-none rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={() => setReasonOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => void handleReasonSubmit()}
                  disabled={submitting || reasonText.trim().length === 0}
                  className="rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
