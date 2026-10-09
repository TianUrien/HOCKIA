import { StrictMode } from 'react'
import { IS_NATIVE } from '@/lib/isNative'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { initSentry } from '@/lib/sentryInit'
import './globals.css'
import App from './App.tsx'
import LaunchSplashController from './components/LaunchSplashController'
import { paintBootLaunchCanvas, warmLaunchArtwork } from './lib/launchSplash'
import { initWebVitals } from './lib/monitor'
import { queryClient } from './lib/queryClient'
import { logger } from './lib/logger'
import { purgeStaleApiCaches } from './lib/purgeStaleApiCaches'
import { initSentryInAppBrowserContext } from './lib/sentryHelpers'
import { registerServiceWorker } from './lib/swUpdate'
import { showUpdatePrompt } from './lib/updatePromptRoot'
import { Capacitor } from '@capacitor/core'
import { hasAnalyticsConsent, enableGA4 } from './lib/cookieConsent'
import { initPostHog } from './lib/posthog'

// Register the service worker (production builds only; the dev server has no
// /sw.js). Prompt-based updates — the page never reloads on its own on the
// web: a new version waits until the user taps Reload. See lib/swUpdate.ts.
if (import.meta.env.PROD) {
  registerServiceWorker({ isNative: Capacitor.isNativePlatform(), showPrompt: showUpdatePrompt })
}

const isNativePlatform = Capacitor.isNativePlatform()
// Native builds use the platform font (SF Pro / Roboto); the web keeps Inter.
// globals.css switches --font-sans on this attribute.
if (IS_NATIVE && typeof document !== 'undefined') document.documentElement.dataset.native = '1'

// Web: @sentry/react. Native: @sentry/capacitor wrapping the same React SDK
// (native crash reporting). Options, filters, PII scrubbing and the
// platform / app_version / app_build tags live in lib/sentryInit.ts.
initSentry()

// Attach the heavyweight integrations once the page has painted and the
// main thread is idle. Errors before this point are still captured by the
// minimal init above; we only defer performance tracing and replay.
const attachDeferredSentryIntegrations = () => {
  try {
    Sentry.addIntegration(Sentry.browserTracingIntegration())
    // Disable session replay on native — sends user interaction data to
    // sentry.io which Apple considers third-party tracking (Guideline 5.1.2)
    if (!isNativePlatform) Sentry.addIntegration(Sentry.replayIntegration())
  } catch (e) {
    logger.debug('[SENTRY] deferred integration attach failed', e)
  }
}
if (typeof window !== 'undefined') {
  const idle = (cb: () => void) =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(cb, { timeout: 4000 })
      : window.setTimeout(cb, 1500)
  // Devices that installed an earlier service worker still carry a populated
  // `supabase-api-cache` holding user-scoped API responses keyed by URL alone.
  // The caching rule is gone (vite.config.ts, 2026-08-08) but existing entries
  // only disappear when we delete them — do it once, off the critical path.
  const purgeOnce = () => { void purgeStaleApiCaches('startup') }
  if (document.readyState === 'complete') idle(() => { attachDeferredSentryIntegrations(); purgeOnce() })
  else window.addEventListener('load', () => idle(() => { attachDeferredSentryIntegrations(); purgeOnce() }), { once: true })
}

// Set up in-app browser context for all Sentry events
// This helps track issues specific to Instagram, WhatsApp, etc. WebViews
initSentryInAppBrowserContext()

const RootErrorFallback = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 text-center">
    <p className="text-lg font-semibold text-gray-800">Something went wrong.</p>
    <p className="text-sm text-gray-500">Our team has been notified via Sentry.</p>
  </div>
)

// Initialize Web Vitals tracking
initWebVitals()

// Load GA4 immediately if user previously consented (no flash of unconsented tracking)
// Skip on native apps — no cookies/GA4 in Capacitor (Apple Guideline 5.1.2)
if (!Capacitor.isNativePlatform() && hasAnalyticsConsent()) {
  enableGA4()
  initPostHog()
}

export function RootApp() {
  return (
    <Sentry.ErrorBoundary fallback={<RootErrorFallback />}>
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          {/* The cookie banner lives inside App's router (next to
              InstallPrompt) so it can stay off the auth and onboarding routes. */}
          <App />
          {/* Last sibling: releases the native launch splash once the first
              frame is real (see components/LaunchSplashController). */}
          <LaunchSplashController />
        </QueryClientProvider>
      </StrictMode>
    </Sentry.ErrorBoundary>
  )
}

// Native only: have the in-app splash artwork fetched + decoded before the
// first React frame needs it (see lib/launchSplash).
warmLaunchArtwork()
// Native only: the page canvas is the artwork's bottom violet until the first
// commit (no white home-indicator band under the in-app splash on iOS).
paintBootLaunchCanvas()

createRoot(document.getElementById('root')!).render(<RootApp />)

export default RootApp
