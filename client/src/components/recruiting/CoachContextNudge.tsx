/**
 * CoachContextNudge — discoverability banner for coaches on Community.
 *
 * Why it exists: coaches have no profile-derived target source (unlike
 * clubs which derive Fit from `mens_league_division` / `womens_league_division`).
 * Without an explicit recruiting context set via ContextSwitcher,
 * `computeClubFit` returns NOT_APPLICABLE for every player and the
 * chip stays hidden — meaning a coach who lands on /community can
 * easily go through an entire session without ever seeing Club Fit,
 * which is HOCKIA's flagship recruitment signal.
 *
 * The empty ContextSwitcher chip wording was clarified
 * ("Set scope to enable Club Fit") but the chip is small and sits
 * above the carousels; first-time coaches scroll past it. This banner
 * makes the value exchange explicit at landing.
 *
 * Visibility:
 *   - Only renders for coaches (other roles hidden — clubs get Fit
 *     without context, players/brands/umpires/anon don't get Fit at all).
 *   - Only when there's NO active recruiting context.
 *   - Dismissible — once the user taps × or sets a context, the
 *     `coach-context-nudge-dismissed` localStorage flag is set and
 *     the banner never re-renders. Setting a context also makes the
 *     no-context predicate false on its own, so the banner naturally
 *     disappears even if dismissal hadn't been triggered.
 */

import { useEffect, useState } from 'react'
import { Target, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import ContextEditSheet from './ContextEditSheet'

const DISMISS_KEY = 'hockia.coach-context-nudge-dismissed'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // localStorage unavailable (private mode quota, etc.) — accept
    // that the banner may reappear next session.
  }
}

interface CoachContextNudgeProps {
  className?: string
}

export default function CoachContextNudge({ className = '' }: CoachContextNudgeProps) {
  const { profile: viewer } = useAuthStore()
  const { active, loading } = useRecruitingContext()
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())
  const [sheetOpen, setSheetOpen] = useState(false)

  // Persist dismissal exactly once when the user taps ×.
  useEffect(() => {
    if (dismissed) writeDismissed()
  }, [dismissed])

  if (viewer?.role !== 'coach') return null
  // Setting any active context resolves the underlying value-gap, so
  // the banner self-hides without needing the dismiss flag.
  if (loading || active) return null
  if (dismissed) return null

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDismissed(true)
  }

  return (
    <>
      <div
        className={[
          'flex items-start gap-3 rounded-xl border border-hockia-primary/20 bg-gradient-to-r from-hockia-primary/[0.04] to-hockia-secondary/[0.04] p-3 sm:p-3.5',
          className,
        ].join(' ')}
        data-testid="coach-context-nudge"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-hockia-primary shadow-sm">
          <Target className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug">
            Unlock Club Fit on every player
          </p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">
            Pick a recruiting scope so HOCKIA can compute Club Fit ratings against the team you&apos;re recruiting for.
          </p>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-hockia-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#6B20D4] focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
          >
            Set scope
          </button>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss Club Fit hint"
          className="flex-shrink-0 -mt-0.5 -mr-0.5 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ContextEditSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}
