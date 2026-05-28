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

import { useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, RefreshCcw, AlertCircle, Clock } from 'lucide-react'
import { useAIOpinion } from '@/hooks/useAIOpinion'
import type { FitCandidateFields } from '@/lib/clubFit'

interface AIOpinionPanelProps {
  candidate: FitCandidateFields
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
  const { status, regenerate } = useAIOpinion(candidate, { enabled: featureEnabled })
  const [citationsOpen, setCitationsOpen] = useState(false)

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
            <button
              type="button"
              onClick={() => void regenerate()}
              className="inline-flex items-center gap-1 font-medium text-[#8026FA] hover:text-[#6B20D4]"
              title="Regenerate the opinion (counts against your daily quota if not cached)"
            >
              <RefreshCcw className="h-3 w-3" />
              Regenerate
            </button>
          </footer>
        </>
      )}
    </section>
  )
}
