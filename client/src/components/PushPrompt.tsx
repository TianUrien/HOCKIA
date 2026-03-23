import { useState, useEffect, useRef } from 'react'
import { Bell, X } from 'lucide-react'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import {
  trackPushSubscribe,
  trackPushPromptShown,
  trackPushPromptDismiss,
} from '@/lib/analytics'

const DISMISS_KEY = 'push-prompt-dismissed'
const DISMISS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

export default function PushPrompt() {
  const push = usePushSubscription()
  const [visible, setVisible] = useState(false)
  const hasTrackedShow = useRef(false)

  // Determine visibility
  useEffect(() => {
    // Push not supported or already subscribed
    if (!push.isSupported || push.isSubscribed || push.permission === 'denied') return

    // Only show after onboarding is complete
    if (!localStorage.getItem('hockia-onboarding-completed') && !localStorage.getItem('playr-onboarding-completed')) return

    // Check 3-day dismiss window
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < DISMISS_WINDOW_MS) return

    // Don't stack with InstallPrompt
    if (localStorage.getItem('pwa-install-visible') === '1') return

    setVisible(true)
  }, [push.isSupported, push.isSubscribed, push.permission])

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
      setVisible(false)
    } catch {
      // Permission denied or error — prompt hides naturally
    }
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString())
    trackPushPromptDismiss()
    setVisible(false)
  }

  if (!visible) return null

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
          className="flex-1 py-2.5 px-4 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
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
