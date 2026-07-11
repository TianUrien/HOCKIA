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

  // Slim single-row bar. Previous version was a 158px tall card that
  // blanketed the bottom of the viewport — at z-9999 it intercepted
  // taps on the bottom nav (avatar, Community, Opportunities) AND on
  // the home feed's per-post action buttons (share, like, comment).
  // Two production-audit findings (and one CI flake) traced back to it.
  //
  // New shape: a compact single-row bar (~64px tall on mobile, ~56px
  // desktop) anchored above the mobile bottom nav so it doesn't sit
  // over any interactive content. Clipboard-style: short copy, two
  // small buttons, dismissable. Desktop drops back to bottom:0 since
  // there's no bottom nav at lg+.
  return (
    <div
      className="fixed inset-x-0 z-[9999] px-3 pb-3 sm:px-6 sm:pb-4 pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+80px)] lg:bottom-0"
      role="region"
      aria-label="Cookie consent"
    >
      <div className="max-w-3xl mx-auto bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-lg pointer-events-auto px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <p className="text-xs sm:text-sm text-gray-700 flex-1 leading-snug">
          We use cookies and analytics to improve your experience.{' '}
          <a href="/privacy-policy" className="text-hockia-primary underline hover:opacity-80 whitespace-nowrap">
            Privacy Policy
          </a>
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleDecline}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="px-4 py-1.5 bg-hockia-primary text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#6b1fd4] transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
