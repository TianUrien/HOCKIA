import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { getConsentStatus, enableGA4 } from '@/lib/cookieConsent'

/**
 * GDPR cookie consent banner.
 * Shown at the bottom of the page until user makes a choice.
 * Choice is persisted in localStorage.
 *
 * Hidden on native iOS/Android apps — no cookies are used in Capacitor
 * and showing this prompt triggers Apple's ATT requirements (Guideline 5.1.2).
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Native apps don't use cookies — skip consent prompt entirely
    if (Capacitor.isNativePlatform()) return

    const status = getConsentStatus()
    if (status === null) {
      setVisible(true)
    } else if (status === 'accepted') {
      enableGA4()
    }
  }, [])

  const handleAccept = () => {
    try { localStorage.setItem('hockia-cookie-consent', 'accepted') } catch { /* ignore */ }
    enableGA4()
    setVisible(false)
  }

  const handleDecline = () => {
    try { localStorage.setItem('hockia-cookie-consent', 'declined') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  // Banner sits above the mobile bottom nav (lg:hidden, ~80px tall + safe
  // area) so it doesn't blanket the avatar / Community / Opportunities
  // buttons and intercept taps. Desktop has no bottom nav, so we drop back
  // to bottom:0 at lg+. Verified by Playwright (qa-avatar-menu-debug spec)
  // — the previous bottom-0 banner sat at z-9999 over the z-40 nav and
  // killed every tap in the bottom 158px.
  return (
    <div className="fixed inset-x-0 z-[9999] p-4 sm:p-6 pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+80px)] lg:bottom-0">
      <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-5 pointer-events-auto">
        <p className="text-sm text-gray-700 mb-4">
          We use cookies and analytics to improve your experience. You can read our{' '}
          <a href="/privacy-policy" className="text-[#8026FA] underline hover:opacity-80">
            Privacy Policy
          </a>{' '}
          for details.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAccept}
            className="flex-1 px-4 py-2.5 bg-[#8026FA] text-white text-sm font-medium rounded-lg hover:bg-[#6b1fd4] transition-colors"
          >
            Accept
          </button>
          <button
            onClick={handleDecline}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  )
}
