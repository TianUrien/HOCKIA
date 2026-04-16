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
 *
 * IMPORTANT: The gtag function MUST use `arguments` (not rest params)
 * because gtag.js expects Arguments objects in the dataLayer, not arrays.
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

  // Initialize dataLayer — must use `arguments` object, not rest params
  window.dataLayer = window.dataLayer || []
  // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-unused-vars -- gtag uses implicit `arguments` object per GA4 snippet
  function gtag(..._args: unknown[]) { window.dataLayer!.push(arguments) }
  gtag('js', new Date())
  gtag('config', GA_ID, { send_page_view: true })

  // Expose gtag globally for analytics.ts
  ;(window as unknown as Record<string, unknown>).gtag = gtag
}
