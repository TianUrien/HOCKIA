import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, X } from 'lucide-react'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { useAuthStore } from '@/lib/auth'
import { INLINE_PUSH_ASK, useBottomPrompt, useBottomPromptActive } from '@/lib/bottomPrompt'
import { COOKIE_BANNER_OVERLAY, INSTALL_OVERLAY, TERMS_GATE_OVERLAY, matchesRoutePrefix } from '@/lib/overlaySequence'
import {
  trackPushSubscribe,
  trackPushPromptShown,
  trackPushPromptDismiss,
} from '@/lib/analytics'

const DISMISS_KEY = 'push-prompt-dismissed'
const DISMISS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

/**
 * Routes where the push card must NEVER render (onboarding QA 2026-10-04):
 * it sat over the buttons of a logged-out /signup and /signup/email because
 * it was keyed to a per-device "onboarding completed" flag left behind by an
 * earlier account. It is a member-only ask.
 */
const PUSH_PROMPT_HIDDEN_PREFIXES = [
  '/signup',
  '/signin',
  '/auth',
  '/verify-email',
  '/complete-profile',
  '/brands/onboarding',
  '/forgot-password',
  '/reset-password',
] as const

function dismissedRecently(): boolean {
  try {
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    return Boolean(dismissedAt) && Date.now() - parseInt(dismissedAt as string, 10) < DISMISS_WINDOW_MS
  } catch {
    return false
  }
}

export default function PushPrompt() {
  const push = usePushSubscription()
  const location = useLocation()
  // Signed in AND onboarding complete, from the live session — never from the
  // per-device localStorage flag, which survives sign-out.
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const onboarded = useAuthStore((s) => s.profile?.onboarding_completed === true)
  const [dismissed, setDismissed] = useState(dismissedRecently)
  const hasTrackedShow = useRef(false)
  // A screen asking in place (Role posted) wins; never show the same ask twice.
  const inlineAsk = useBottomPromptActive(INLINE_PUSH_ASK)
  // One overlay at a time: Terms → cookie banner → install card → this card.
  const termsOpen = useBottomPromptActive(TERMS_GATE_OVERLAY)
  const cookieOpen = useBottomPromptActive(COOKIE_BANNER_OVERLAY)
  const installOpen = useBottomPromptActive(INSTALL_OVERLAY)

  const supported = push.isSupported && !push.isSubscribed && push.permission !== 'denied'
  const onHiddenRoute = matchesRoutePrefix(location.pathname, PUSH_PROMPT_HIDDEN_PREFIXES)
  const visible =
    supported &&
    signedIn &&
    onboarded &&
    !onHiddenRoute &&
    !dismissed &&
    !inlineAsk &&
    !termsOpen &&
    !cookieOpen &&
    !installOpen

  useBottomPrompt('push', visible)

  // Track impression once
  useEffect(() => {
    if (visible && !hasTrackedShow.current) {
      trackPushPromptShown()
      hasTrackedShow.current = true
    }
  }, [visible])

  const handleEnable = async () => {
    try {
      await push.subscribe()
      trackPushSubscribe('prompt')
      setDismissed(true)
    } catch {
      // Permission denied or error — prompt hides naturally
    }
  }

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, Date.now().toString()) } catch { /* storage blocked */ }
    trackPushPromptDismiss()
    setDismissed(true)
  }

  if (!visible) return null

  // Prerender snapshot (scripts/prerender-landing.mjs): overlays must
  // never be baked into the static landing HTML. Placed AFTER all hooks
  // (rules-of-hooks); the flag is constant for the page's lifetime.
  if (typeof window !== 'undefined' && (window as unknown as { __PRERENDER__?: boolean }).__PRERENDER__) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50 animate-slide-up">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Bell className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Stay in the loop</h3>
          <p className="text-xs text-gray-600 mt-0.5">
            Get notified about messages, applications, and opportunities — even when the app is closed.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleEnable}
          disabled={push.loading}
          className="flex-1 py-2.5 px-4 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Bell className="w-4 h-4" />
          Enable Notifications
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
