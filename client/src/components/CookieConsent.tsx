import { useState, useEffect } from 'react'

const CONSENT_KEY = 'hockia-cookie-consent'

type ConsentStatus = 'accepted' | 'declined' | null

/** Returns the stored consent status without showing UI. */
export function getConsentStatus(): ConsentStatus {
  try {
    const stored = localStorage.getItem(CONSENT_KEY)
    if (stored === 'accepted' || stored === 'declined') return stored
  } catch {
    // localStorage blocked (e.g. Safari incognito)
  }
  return null
}

/** Returns true if the user has accepted analytics cookies. */
export function hasAnalyticsConsent(): boolean {
  return getConsentStatus() === 'accepted'
}

/**
 * Enable GA4 by loading the gtag script dynamically.
 * Only called after explicit user consent.
 */
export function enableGA4() {
  const GA_ID = 'G-1QZ48FMV1V'

  // Don't load twice
  if (document.querySelector(`script[src*="googletagmanager"]`)) return

  // Load gtag.js
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || []
  function gtag(...args: unknown[]) {
    window.dataLayer.push(args)
  }
  gtag('js', new Date())
  gtag('config', GA_ID, { send_page_view: true })

  // Expose gtag globally for analytics.ts
  ;(window as Record<string, unknown>).gtag = gtag
}

/**
 * GDPR cookie consent banner.
 * Shown at the bottom of the page until user makes a choice.
 * Choice is persisted in localStorage.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const status = getConsentStatus()
    if (status === null) {
      setVisible(true)
    } else if (status === 'accepted') {
      enableGA4()
    }
  }, [])

  const handleAccept = () => {
    try { localStorage.setItem(CONSENT_KEY, 'accepted') } catch { /* ignore */ }
    enableGA4()
    setVisible(false)
  }

  const handleDecline = () => {
    try { localStorage.setItem(CONSENT_KEY, 'declined') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-[9999] p-4 sm:p-6 pointer-events-none">
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

// Window.dataLayer and Window.gtag types are declared in lib/analytics.ts
