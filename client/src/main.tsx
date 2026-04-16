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
if ('serviceWorker' in navigator) {
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
      logger.info('[PWA] New content available, showing update prompt')
      showUpdatePrompt(updateSW)
    },
    onRegisterError(error) {
      logger.error('[PWA] Service Worker registration failed:', error)
    },
  })
}

const sentryEnvironment = import.meta.env.MODE === 'production' ? 'production' : 'development'

const isNativePlatform = Capacitor.isNativePlatform()

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN),
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
