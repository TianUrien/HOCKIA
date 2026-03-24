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
  const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-NE620GQKTX'

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
    window.dataLayer!.push(args)
  }
  gtag('js', new Date())
  gtag('config', GA_ID, { send_page_view: true })

  // Expose gtag globally for analytics.ts
  ;(window as unknown as Record<string, unknown>).gtag = gtag
}
