import { Capacitor } from '@capacitor/core'

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
  // Never load GA4 on native iOS/Android (Apple Guideline 5.1.2)
  if (Capacitor.isNativePlatform()) return

  // Don't load GA for automated browsers — Playwright/Selenium e2e set
  // navigator.webdriver=true. The e2e suite runs against production and was
  // firing thousands of GA hits (test routes like /clubs/e2e-test-fc), drowning
  // real users in bot noise — the single biggest distortion in the GA data.
  // Gating the script load here stops every automated hit at the source.
  if (typeof navigator !== 'undefined' && navigator.webdriver) return

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
  // send_page_view: false because gtag's auto-fired initial page_view
  // would carry the raw window.location.href + document.title (both
  // can include UUIDs / profile names). lib/analytics.ts owns ALL
  // page_view events — trackPageView fires sanitized payloads from
  // App.tsx's route useEffect, including the first render after
  // consent is granted.
  gtag('config', GA_ID, { send_page_view: false })

  // Default everyone to logged-out so EVERY event before login carries the
  // logged_in property — the single most useful dimension for "why don't
  // logged-out visitors convert". setUserProperties flips it to 'true' on
  // login; clearUserProperties resets it to 'false' on logout.
  gtag('set', 'user_properties', { logged_in: 'false' })

  // Expose gtag globally for analytics.ts
  ;(window as unknown as Record<string, unknown>).gtag = gtag
}
