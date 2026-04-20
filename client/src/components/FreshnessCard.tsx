import { useEffect, useState } from 'react'
import { ArrowRight, Clock, X } from 'lucide-react'
import { logger } from '@/lib/logger'
import type { FreshnessNudge, FreshnessNudgeId } from '@/lib/profileFreshness'

interface FreshnessCardProps {
  nudge: FreshnessNudge | null
  /** Called when the owner taps the CTA. */
  onAction?: (nudge: FreshnessNudge) => void
}

const DISMISS_KEY_PREFIX = 'hockia-freshness-dismiss:'
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function getDismissKey(id: FreshnessNudgeId): string {
  return `${DISMISS_KEY_PREFIX}${id}`
}

/**
 * Returns true when this nudge was dismissed less than 7 days ago, so the
 * card should stay hidden. Handles SSR / blocked-localStorage environments
 * by falling through to "not dismissed" on any read error.
 */
function isDismissed(id: FreshnessNudgeId, now: number = Date.now()): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const raw = window.localStorage.getItem(getDismissKey(id))
    if (!raw) return false
    const ts = Date.parse(raw)
    if (Number.isNaN(ts)) return false
    return now - ts < DISMISS_COOLDOWN_MS
  } catch {
    return false
  }
}

function recordDismiss(id: FreshnessNudgeId): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(getDismissKey(id), new Date().toISOString())
  } catch (err) {
    logger.error('[FreshnessCard] failed to persist dismissal', err)
  }
}

/**
 * Lightweight nudge card shown beneath NextStepCard on owner dashboards.
 * Displays a single freshness nudge (e.g. "Your Journey hasn't been updated
 * in 5 weeks") with a CTA and a dismiss button. Dismissals persist in
 * localStorage for 7 days so the same nudge doesn't re-appear on every tab
 * switch — but we intentionally do NOT persist to Supabase; a cleared
 * browser is a fine "start over" signal here.
 *
 * Renders nothing when the nudge is null (every section is fresh) or when
 * the owner dismissed this nudge id within the cooldown window.
 */
export default function FreshnessCard({ nudge, onAction }: FreshnessCardProps) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(nudge ? isDismissed(nudge.id) : false)
  }, [nudge])

  if (!nudge || hidden) return null

  const handleDismiss = () => {
    recordDismiss(nudge.id)
    setHidden(true)
  }

  const handleAction = () => {
    onAction?.(nudge)
  }

  return (
    <div className="relative rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5 shadow-sm">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this nudge"
        className="absolute top-2.5 right-2.5 p-1.5 rounded-full text-amber-700/60 hover:text-amber-900 hover:bg-amber-100 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-700">
          <Clock className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-0.5">
            Keep it fresh
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">{nudge.message}</p>
          <button
            type="button"
            onClick={handleAction}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-amber-600 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm hover:bg-amber-700 transition-colors"
          >
            {nudge.ctaLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
