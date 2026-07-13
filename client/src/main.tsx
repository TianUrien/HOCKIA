import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { registerSW } from 'virtual:pwa-register'
import './globals.css'
import App from './App.tsx'
import { initWebVitals } from './lib/monitor'
import { queryClient } from './lib/queryClient'
import { logger } from './lib/logger'
import { initSentryInAppBrowserContext } from './lib/sentryHelpers'
import UpdatePrompt from './components/UpdatePrompt'
import CookieConsent from './components/CookieConsent'
import { Capacitor } from '@capacitor/core'
import { hasAnalyticsConsent, enableGA4 } from './lib/cookieConsent'

// Create a container for the update prompt (outside main React tree)
let updatePromptRoot: ReturnType<typeof createRoot> | null = null

function showUpdatePrompt(updateSW: (reloadPage?: boolean) => Promise<void>) {
  // Create container if it doesn't exist
  let container = document.getElementById('update-prompt-root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'update-prompt-root'
    document.body.appendChild(container)
  }

  // Render the update prompt
  if (!updatePromptRoot) {
    updatePromptRoot = createRoot(container)
  }

  updatePromptRoot.render(
    <UpdatePrompt
      onUpdate={async () => {
        // Hide the prompt
        updatePromptRoot?.unmount()
        updatePromptRoot = null
        container?.remove()
        // Trigger the service worker update and reload
        // The true parameter tells vite-plugin-pwa to reload the page
        await updateSW(true)
      }}
    />
  )
}

// Register Service Worker for PWA
//
// Update strategy (registerType: 'prompt'): a freshly deployed build
// installs as a "waiting" service worker and does NOT take over until
// it is applied. We apply it two ways:
//   1. A banner ("A new version is available") for an immediate update.
//   2. Auto-apply when the app is backgrounded — the reload runs while
//      the app is hidden, so the user never sees it mid-session and the
//      next launch is already on the latest build. Mobile users
//      background the app constantly, so a stale version cannot persist
//      across app switches even if the banner is missed.
if ('serviceWorker' in navigator) {
  let updatePending = false

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(swScriptUrl, registration) {
      logger.debug('[PWA] Service Worker registered:', swScriptUrl)
      if (registration) {
        // Check for updates immediately on registration
        registration.update().catch((err) => logger.error('[PWA] Update check failed:', err))

        // Check for updates every 15 minutes, but only when tab is visible
        let intervalId: ReturnType<typeof setInterval> | null = null

        const startUpdateLoop = () => {
          if (intervalId) return
          intervalId = setInterval(() => {
            logger.debug('[PWA] Checking for updates...')
            registration.update().catch((err) => logger.error('[PWA] Update check failed:', err))
          }, 15 * 60 * 1000)
        }

        const stopUpdateLoop = () => {
          if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
          }
        }

        const handleVisibilityChange = () => {
          if (document.hidden) {
            stopUpdateLoop()
            // App going to background with an update waiting — apply it
            // now. The reload runs while the app is hidden, so it is
            // invisible to the user and the next launch is already fresh.
            if (updatePending) {
              logger.info('[PWA] Applying pending update while backgrounded')
              void updateSW(true)
            }
          } else {
            // Check immediately when tab becomes visible, then resume loop
            registration.update().catch((err) => logger.error('[PWA] Update check failed:', err))
            startUpdateLoop()
          }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        startUpdateLoop()
      }
    },
    onOfflineReady() {
      logger.info('[PWA] App is ready for offline use')
    },
    onNeedRefresh() {
      logger.info('[PWA] New content available — banner shown; will auto-apply on background')
      updatePending = true
      showUpdatePrompt(updateSW)
    },
    onRegisterError(error) {
      logger.error('[PWA] Service Worker registration failed:', error)
    },
  })
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

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Never report from development: local sessions, HMR artifacts and
  // dev-server e2e teardowns were ~85% of the Sentry feed (2026-07-14
  // triage), burying real production signals.
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN) && sentryEnvironment !== 'development',
  environment: sentryEnvironment,
  // Release tag — set via Vercel/Capacitor build env. Falls back to 'unknown'
  // so events from an untagged build are still identifiable in Sentry.
  release: import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || 'unknown',
  integrations: [
    Sentry.browserTracingIntegration(),
    // Disable session replay on native — sends user interaction data to sentry.io
    // which Apple considers third-party tracking (Guideline 5.1.2)
    ...(!isNativePlatform ? [Sentry.replayIntegration()] : []),
  ],
  tracesSampleRate: sentryEnvironment === 'production' ? 0.3 : 1.0,
  replaysSessionSampleRate: isNativePlatform ? 0 : (sentryEnvironment === 'production' ? 0.05 : 1.0),
  replaysOnErrorSampleRate: isNativePlatform ? 0 : 1.0,
  // Substring-matched against the error message. These are expected
  // user-input errors from Supabase Auth — not application bugs — and
  // should not page anyone or clutter the dashboard.
  ignoreErrors: [
    // Wrong password / wrong email entry on /signin
    'Invalid login credentials',
    // /signup or /signin hammered too quickly — Supabase rate limit
    'Email rate limit exceeded',
    // Duplicate signup attempt — UI should already guide them to /signin
    'User already registered',
  ],
  beforeSend(event) {
    // Scrub PII from error events before sending to Sentry
    if (event.user) {
      delete event.user.email
      delete event.user.ip_address
      delete event.user.username
    }
    // Scrub email-like patterns from breadcrumb messages
    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        if (typeof crumb.message === 'string') {
          crumb.message = crumb.message.replace(
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
            '[REDACTED_EMAIL]'
          )
        }
      }
    }
    return event
  },
})

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
}

export function RootApp() {
  return (
    <Sentry.ErrorBoundary fallback={<RootErrorFallback />}>
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
          <CookieConsent />
        </QueryClientProvider>
      </StrictMode>
    </Sentry.ErrorBoundary>
  )
}

createRoot(document.getElementById('root')!).render(<RootApp />)

export default RootApp
