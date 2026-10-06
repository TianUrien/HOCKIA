import { StrictMode } from 'react'
import { IS_NATIVE } from '@/lib/isNative'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { isNetworkFailureMessage } from '@/lib/sentryHelpers'
import { EXPECTED_REFUSAL_MESSAGES, isExpectedRefusal } from '@/lib/sentryFilters'
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentryScrub'
import { getAppVersion } from '@/lib/appVersion'
import './globals.css'
import App from './App.tsx'
import LaunchSplashController from './components/LaunchSplashController'
import { warmLaunchArtwork } from './lib/launchSplash'
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

// Environment: staging is a production-MODE build (Vercel), so MODE can't
// distinguish it — the baked-in Supabase project ref can (house staging-
// detection pattern, same as OpportunitiesPage).
const sentryEnvironment =
  import.meta.env.MODE !== 'production'
    ? 'development'
    : import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
      ? 'staging'
      : 'production'

const isNativePlatform = Capacitor.isNativePlatform()
// Native builds use the platform font (SF Pro / Roboto); the web keeps Inter.
// globals.css switches --font-sans on this attribute.
if (IS_NATIVE && typeof document !== 'undefined') document.documentElement.dataset.native = '1'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Never report from development: local sessions, HMR artifacts and
  // dev-server e2e teardowns were ~85% of the Sentry feed (2026-07-14
  // triage), burying real production signals.
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN) && sentryEnvironment !== 'development',
  environment: sentryEnvironment,
  // The SAME release name the source-map upload used (vite.config.ts →
  // lib/sentryRelease): web@<sha> on Vercel, native@<sha> in the Capacitor
  // bundle, dev locally. Native store version/build are tags (set below).
  release: import.meta.env.VITE_SENTRY_RELEASE || 'dev',
  // PERF (Lighthouse 2026-07-29): integrations attach AFTER first paint —
  // see below. init() itself is cheap; browserTracing + replay setup were
  // part of a 5.4s mobile render delay (sentry chunk alone: 643ms boot-up
  // time on emulated mobile). Error capture works from this line; only the
  // tracing/replay extras wait for idle.
  integrations: [],
  tracesSampleRate: sentryEnvironment === 'production' ? 0.3 : 1.0,
  replaysSessionSampleRate: isNativePlatform ? 0 : (sentryEnvironment === 'production' ? 0.05 : 1.0),
  replaysOnErrorSampleRate: isNativePlatform ? 0 : 1.0,
  // Substring-matched against the error message. These are expected
  // user-input errors from Supabase Auth — not application bugs — and
  // should not page anyone or clutter the dashboard.
  ignoreErrors: [
    // A native OAuth attempt deliberately superseded by a newer tap — expected,
    // handled in lib/nativeOAuth + AuthScreen; belt-and-braces here.
    'OAuth cancelled — superseded by a newer sign-in attempt',
    // Wrong password / wrong email entry on /signin
    'Invalid login credentials',
    // /signup or /signin hammered too quickly — Supabase rate limit
    'Email rate limit exceeded',
    // Duplicate signup attempt — UI should already guide them to /signin
    'User already registered',
    // Leaked-password protection (enabled 2026-08-27) rejecting a weak or
    // breached password — the form shows the message; it is user input.
    'Password is known to be weak',
    // Auth endpoint cooldown after a rapid retry (resend / reset) — a
    // guardrail firing as designed, not a failure.
    'you can only request this after',
    // Tried to sign in before clicking the verification email — user input.
    'Email not confirmed',
    // iOS WKWebView injected-script noise (Sentry JAVASCRIPT-REACT-CF,
    // 2026-09-01): no source file, symbol not in our bundle — a system or
    // reader-mode script erroring inside the webview, not our code.
    "Can't find variable: EmptyRanges",
    // Microsoft Outlook SafeLink scanner executing our JS while previewing
    // emailed links — a well-known bot artifact, not a user (Sentry triage
    // 2026-08-07: fired only from /community with 0 real users).
    'Object Not Found Matching Id',
    // React Query cancels in-flight fetches on unmount/navigation; the
    // rejection is the mechanism working, not a failure.
    'CancelledError',
    // Expected auth outcomes (Sentry triage 2026-09-24): the user left the
    // OAuth flow open, or hit a signed-out page — the UI already explains.
    'OAuth timed out after 5 minutes',
    'Auth session missing',
    // Android WebView bridge torn down mid-call after the app was
    // backgrounded — the OS reclaimed the page, not a code path.
    'Java object is gone',
    // Deliberate business refusals the UI already explains (blocked member,
    // daily new-conversation allowance) — release audit 2026-10-06.
    ...EXPECTED_REFUSAL_MESSAGES,
  ],
  beforeBreadcrumb(crumb) {
    // Navigation / fetch URLs can carry auth tokens (#access_token, ?code=).
    return scrubBreadcrumb(crumb)
  },
  beforeSendTransaction(event) {
    return scrubEvent(event)
  },
  beforeSend(event, hint) {
    // Network failures (Safari "Load failed", Chrome "Failed to fetch"): the
    // request never reached the server — offline, a blocked ISP, a dropped
    // connection. Nothing in the app to fix, and they hide real errors in
    // the alert stream. Keep them COUNTED so an outage spike stays visible,
    // but as info-level, tagged, and sampled 1 in 4 (founder ruling
    // 2026-09-24: out of alerts, still counted). Alert rules key on
    // level:error, so these never page.
    const original = hint?.originalException
    if (isExpectedRefusal(original)) return null
    const message = [event.message, ...(event.exception?.values?.map((v) => v.value) ?? []), original instanceof Error ? original.message : '']
      .filter((m): m is string => typeof m === 'string')
      .join('\n')
    if (isNetworkFailureMessage(message)) {
      if (Math.random() >= 0.25) return null
      event.level = 'info'
      event.tags = { ...event.tags, network_failure: 'true' }
      event.fingerprint = ['network-failure']
    }
    // Scrub PII before sending: user email/IP/username, emails in messages,
    // exception values and breadcrumbs, and auth tokens / the hash in URLs.
    return scrubEvent(event)
  },
})

// Which shell is running, plus (native) the store version and build — one web
// bundle serves both native apps, so these can only be known at runtime.
Sentry.setTag('platform', isNativePlatform ? Capacitor.getPlatform() : 'web')
if (isNativePlatform) {
  void getAppVersion().then((info) => {
    if (!info) return
    Sentry.setTags({ app_version: info.version, app_build: info.build })
  })
}

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

createRoot(document.getElementById('root')!).render(<RootApp />)

export default RootApp
