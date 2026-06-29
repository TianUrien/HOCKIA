import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Star, X } from 'lucide-react'
import { useBottomPrompt } from '@/lib/bottomPrompt'
import {
  APP_RATING_ENABLED,
  shouldShowRatingPrompt,
  recordRatingPromptShown,
  recordRatingPromptDismissed,
  submitRating,
  type RatingDecision,
} from '@/lib/appRating'

/**
 * Internal app rating prompt (Slice 1). A small, dismissible card — never a
 * blocking modal. The server decides eligibility (onboarding + >=7 active days,
 * once/day, +10-active-day backoff, cap 3, never after rating); this component
 * only renders on CALM surfaces (home feed / discover / community) so it never
 * appears during onboarding, applying, messaging, or profile editing.
 *
 * Flow: stars -> (4-5) "anything you love?" / (1-3) "what can we improve?" -> an
 * optional one-line comment -> submit. No App Store routing in this slice.
 */
const COMMENT_MAX = 500

// Calm browse/feed surfaces only. Everything else (messages, dashboard editing,
// opportunity apply, onboarding) is intentionally excluded.
function isCalmSurface(pathname: string): boolean {
  return pathname === '/home' || pathname === '/discover' || pathname.startsWith('/community')
}

export default function AppRatingPrompt() {
  const location = useLocation()
  const calm = isCalmSurface(location.pathname)

  const [decision, setDecision] = useState<RatingDecision | null>(null)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [closed, setClosed] = useState(false)
  const queriedRef = useRef(false)
  const shownRef = useRef(false)

  // Lowest-priority bottom prompt: claim a slot while the card wants to show, so the
  // AI FAB and other bottom prompts defer to it; we defer while a higher prompt is up.
  const wantsToShow = Boolean(decision?.show) && !closed && calm
  const otherActive = useBottomPrompt('rating', wantsToShow)

  // Ask the server once per session, on the first calm surface. Stacking with other
  // bottom prompts is handled reactively by the coordinator (otherActive), so the
  // query itself isn't gated on it.
  useEffect(() => {
    if (!APP_RATING_ENABLED || !calm || closed || queriedRef.current) return
    queriedRef.current = true
    let cancelled = false
    void (async () => {
      const d = await shouldShowRatingPrompt()
      if (!cancelled && d.show) setDecision(d)
    })()
    return () => {
      cancelled = true
    }
  }, [calm, closed])

  // Record "shown" exactly once, when the card actually renders (not while deferred
  // behind another prompt).
  useEffect(() => {
    if (decision?.show && calm && !closed && !otherActive && !shownRef.current) {
      shownRef.current = true
      recordRatingPromptShown()
    }
  }, [decision, calm, closed, otherActive])

  if (!decision?.show || closed || !calm || otherActive) return null

  const handleDismiss = () => {
    if (!submitted) recordRatingPromptDismissed()
    setClosed(true)
  }

  const handleSubmit = async () => {
    if (rating < 1 || submitting) return
    setSubmitting(true)
    setSubmitError(false)
    const ok = await submitRating(rating, comment, decision.trigger)
    setSubmitting(false)
    if (ok) {
      setSubmitted(true)
      window.setTimeout(() => setClosed(true), 2600)
    } else {
      setSubmitError(true)
    }
  }

  const isPositive = rating >= 4
  const display = hover || rating

  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl animate-slide-up md:bottom-6 md:left-auto md:right-4 md:w-96">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {submitted ? (
        <div className="py-2 text-center">
          <div className="text-2xl">💜</div>
          <p className="mt-1 text-sm font-semibold text-gray-900">Thank you!</p>
          <p className="mt-0.5 text-xs text-gray-600">Your feedback helps us improve HOCKIA.</p>
        </div>
      ) : (
        <>
          <h3 className="pr-6 text-base font-bold text-gray-900">Enjoying HOCKIA?</h3>
          <p className="mt-0.5 text-xs text-gray-600">
            Your feedback helps us improve the field hockey community.
          </p>

          <div
            className="mt-3 flex items-center gap-1.5"
            role="radiogroup"
            aria-label="Rate HOCKIA from 1 to 5 stars"
            onMouseLeave={() => setHover(0)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === rating ? 'true' : 'false'}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                className="p-1 transition-transform hover:scale-110"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >
                <Star
                  className={`h-7 w-7 ${n <= display ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-gray-300'}`}
                />
              </button>
            ))}
          </div>

          {rating >= 1 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-gray-700">
                {isPositive ? 'Thanks! 🎉 Anything you love or want more of?' : 'Thanks for the honesty — what can we improve?'}
                <span className="font-normal text-gray-400"> (optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                rows={2}
                placeholder={isPositive ? 'What stood out for you?' : 'Tell us what would make it better…'}
                className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 p-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#8026FA] focus:outline-none focus:ring-1 focus:ring-[#8026FA]"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit feedback'}
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3 py-2.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
                >
                  Not now
                </button>
              </div>
              {submitError && (
                <p className="mt-2 text-xs text-rose-600" role="alert">
                  Couldn’t send your feedback — please try again.
                </p>
              )}
            </div>
          )}

          {rating === 0 && (
            <button
              type="button"
              onClick={handleDismiss}
              className="mt-2 text-xs text-gray-400 transition-colors hover:text-gray-600"
            >
              Not now
            </button>
          )}
        </>
      )}
    </div>
  )
}
