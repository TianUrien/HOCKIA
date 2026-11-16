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
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { useSettingsT } from '@/i18n/ns/settings'

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
// Never right after opening the app (iOS audit 2026-11-06: it covered Home within
// seconds of signing in). Ask once the member has been here a while and moved on
// from the first screen.
export const RATING_SESSION_DELAY_MS = 60_000
export const RATING_MIN_SCREENS = 2

// Calm browse/feed surfaces only. Everything else (messages, dashboard editing,
// opportunity apply, onboarding) is intentionally excluded.
function isCalmSurface(pathname: string): boolean {
  return pathname === '/home' || pathname.startsWith('/community')
}

export default function AppRatingPrompt() {
  // The comment field sits low on the screen: rise above the iOS keyboard while typing.
  const kb = useKeyboardInset(true)
  const t = useSettingsT()
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
  const [settled, setSettled] = useState(false)
  const [screens, setScreens] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), RATING_SESSION_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => { setScreens((n) => n + 1) }, [location.pathname])
  const ready = settled && screens >= RATING_MIN_SCREENS

  // Lowest-priority bottom prompt: claim a slot while the card wants to show, so the
  // AI FAB and other bottom prompts defer to it; we defer while a higher prompt is up.
  const wantsToShow = Boolean(decision?.show) && !closed && calm
  const otherActive = useBottomPrompt('rating', wantsToShow)

  // Ask the server once per session, on a calm surface once the session has settled. Stacking with other
  // bottom prompts is handled reactively by the coordinator (otherActive), so the
  // query itself isn't gated on it.
  useEffect(() => {
    if (!APP_RATING_ENABLED || !ready || !calm || closed || queriedRef.current) return
    queriedRef.current = true
    let cancelled = false
    void (async () => {
      const d = await shouldShowRatingPrompt()
      if (!cancelled && d.show) setDecision(d)
    })()
    return () => {
      cancelled = true
    }
  }, [ready, calm, closed])

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
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl animate-slide-up md:bottom-6 md:left-auto md:right-4 md:w-96" style={kb.inset ? { bottom: kb.inset + 12 } : undefined}>
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        aria-label={t('ratingPrompt.dismiss')}
      >
        <X className="h-4 w-4" />
      </button>

      {submitted ? (
        <div className="py-2 text-center">
          <div className="text-2xl">💜</div>
          <p className="mt-1 text-sm font-semibold text-gray-900">{t('ratingPrompt.thanksTitle')}</p>
          <p className="mt-0.5 text-xs text-gray-600">{t('ratingPrompt.thanksBody')}</p>
        </div>
      ) : (
        <>
          <h3 className="pr-6 text-base font-bold text-gray-900">{t('ratingPrompt.title')}</h3>
          <p className="mt-0.5 text-xs text-gray-600">
            {t('ratingPrompt.body')}
          </p>

          <div
            className="mt-3 flex items-center gap-1.5"
            role="radiogroup"
            aria-label={t('ratingPrompt.starsLabel')}
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
                aria-label={t('ratingPrompt.star', { count: n })}
              >
                <Star
                  className={`h-7 w-7 ${n <= display ? 'fill-gold-line text-gold-line' : 'fill-transparent text-gray-500'}`}
                />
              </button>
            ))}
          </div>

          {rating >= 1 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-gray-700">
                {isPositive ? t('ratingPrompt.positiveQuestion') : t('ratingPrompt.negativeQuestion')}
                <span className="font-normal text-gray-400">{t('ratingPrompt.optional')}</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                rows={2}
                placeholder={isPositive ? t('ratingPrompt.positivePlaceholder') : t('ratingPrompt.negativePlaceholder')}
                className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 p-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-hockia-primary"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? t('ratingPrompt.submitting') : t('ratingPrompt.submit')}
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3 py-2.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
                >
                  {t('ratingPrompt.notNow')}
                </button>
              </div>
              {submitError && (
                <p className="mt-2 text-xs text-status-danger" role="alert">
                  {t('ratingPrompt.failed')}
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
              {t('ratingPrompt.notNowEarly')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
