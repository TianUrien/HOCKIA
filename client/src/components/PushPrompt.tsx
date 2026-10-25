import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { useAuthStore } from '@/lib/auth'
import { INLINE_PUSH_ASK, useBottomPrompt, useBottomPromptActive } from '@/lib/bottomPrompt'
import { COOKIE_BANNER_OVERLAY, INSTALL_OVERLAY, TERMS_GATE_OVERLAY, matchesRoutePrefix } from '@/lib/overlaySequence'
import { clearPushAsk, markPushAskDone, pushAskDone, shouldShowPushAsk, usePendingPushAsk } from '@/lib/pushAsk'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import {
  trackPushSubscribe,
  trackPushPromptShown,
  trackPushPromptDismiss,
} from '@/lib/analytics'

/**
 * Routes where the push ask must NEVER render (onboarding QA 2026-10-04):
 * it is a member-only ask.
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

export const PUSH_ASK_TITLE = 'Stay in the loop'
export const PUSH_ASK_BODY = 'Get notified about messages, applications and opportunities, even when the app is closed.'

/**
 * The notification ask (design audit 2026-10-21, A1). A bottom sheet (r28)
 * that opens once per member, only after a moment of intent (a successful
 * Apply, posting a role, a first message: `lib/pushAsk.ts`). As a modal
 * sheet it never sits on top of a sticky action bar. Turn on, Not now or
 * closing it all count as seen: it never comes back for this member.
 * The permission and subscription logic is unchanged (usePushSubscription).
 */
export default function PushPrompt() {
  const push = usePushSubscription()
  const location = useLocation()
  // Signed in AND onboarding complete, from the live session.
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const onboarded = useAuthStore((s) => s.profile?.onboarding_completed === true)
  const moment = usePendingPushAsk()
  const [open, setOpen] = useState(false)
  // A screen asking in place (Role posted) wins; never show the same ask twice.
  const inlineAsk = useBottomPromptActive(INLINE_PUSH_ASK)
  // One overlay at a time: Terms → cookie banner → install card → this ask.
  const termsOpen = useBottomPromptActive(TERMS_GATE_OVERLAY)
  const cookieOpen = useBottomPromptActive(COOKIE_BANNER_OVERLAY)
  const installOpen = useBottomPromptActive(INSTALL_OVERLAY)

  const done = pushAskDone(userId)
  const visible = shouldShowPushAsk({
    moment,
    done,
    supported: push.isSupported,
    subscribed: push.isSubscribed,
    permission: push.permission,
    signedIn: Boolean(userId),
    onboarded,
    onHiddenRoute: matchesRoutePrefix(location.pathname, PUSH_PROMPT_HIDDEN_PREFIXES),
    otherOverlay: inlineAsk || termsOpen || cookieOpen || installOpen,
  })

  useBottomPrompt('push', visible || open)

  // A moment that can't be asked about (already done, already subscribed,
  // denied) is dropped, so it never pops up later out of context.
  useEffect(() => {
    if (moment && (done || push.isSubscribed || push.permission === 'denied' || push.permission === 'granted')) clearPushAsk()
  }, [moment, done, push.isSubscribed, push.permission])

  // Shown once per member: mark it seen as soon as it opens.
  // Deferred a tick so an overlay claiming its slot in the same commit
  // (Terms gate, cookie banner) wins first; the cleanup cancels it then.
  useEffect(() => {
    if (!visible || open) return
    const t = setTimeout(() => {
      trackPushPromptShown()
      markPushAskDone(userId)
      setOpen(true)
    }, 0)
    return () => clearTimeout(t)
  }, [visible, open, userId])

  const close = () => {
    markPushAskDone(userId)
    clearPushAsk()
    setOpen(false)
  }

  const handleEnable = async () => {
    try {
      await push.subscribe()
      trackPushSubscribe('prompt')
    } catch {
      // Permission denied or error: the hook logs it.
    }
    close()
  }

  const handleDismiss = () => {
    trackPushPromptDismiss()
    close()
  }

  // Prerender snapshot (scripts/prerender-landing.mjs): overlays must
  // never be baked into the static landing HTML.
  if (typeof window !== 'undefined' && (window as unknown as { __PRERENDER__?: boolean }).__PRERENDER__) return null

  return (
    <BottomSheet open={open} onClose={handleDismiss} ariaLabel={PUSH_ASK_TITLE} initialFocus="panel">
      <div className="flex flex-col items-center gap-3 px-6 pb-4 pt-3 text-center" data-testid="push-ask-sheet">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand-primary" aria-hidden="true">
          <Bell className="h-7 w-7" strokeWidth={2} />
        </span>
        <h2 className="text-title text-ink-1">{PUSH_ASK_TITLE}</h2>
        <p className="text-row text-ink-2">{PUSH_ASK_BODY}</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button variant="primary" size="large" block onClick={() => void handleEnable()} loading={push.loading}>
            Turn on notifications
          </Button>
          <Button variant="tertiary" size="large" block onClick={handleDismiss}>
            Not now
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
