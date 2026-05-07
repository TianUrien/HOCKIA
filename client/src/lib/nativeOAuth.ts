/**
 * Native OAuth handler for Capacitor iOS/Android apps.
 *
 * On native platforms, OAuth must be handled differently:
 * 1. Get the OAuth URL from Supabase (without auto-redirect)
 * 2. Open it in an in-app browser (SFSafariViewController on iOS)
 * 3. Listen for the app to receive the callback via deep link
 * 4. Exchange the auth code/tokens
 *
 * This avoids the "Safari opens with error" issue that Apple rejected.
 */
import * as Sentry from '@sentry/react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { supabase } from './supabase'
import { logger } from './logger'
import { reportAuthFlowError } from './sentryHelpers'
import { scopesFor } from './oauthSignIn'

function breadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category: 'auth.native_oauth', level: 'info', message, data })
}

/** Returns true when running inside Capacitor native shell. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

/**
 * Module-level cancellation handle for the in-flight OAuth attempt.
 * If a user starts OAuth, navigates away mid-flow, then starts a new
 * OAuth before the 5-minute timeout, the previous attempt's appUrlOpen
 * listener would still be registered — the next callback URL would be
 * processed by BOTH listeners, and the older one would fail to exchange
 * an already-consumed code (or worse, race the newer one).
 *
 * cancelInFlight() is invoked at the top of each new signInWithOAuthNative
 * call so only the most recent attempt's listener is live.
 */
let cancelInFlight: (() => void) | null = null

/**
 * Start OAuth sign-in for native apps.
 *
 * @param provider - OAuth provider ('apple' | 'google')
 * @returns Promise that resolves when auth is complete, or rejects on error
 */
export async function signInWithOAuthNative(provider: 'apple' | 'google'): Promise<void> {
  if (!isNativePlatform()) {
    throw new Error('signInWithOAuthNative should only be called on native platforms')
  }

  // Cancel any prior in-flight OAuth attempt so its listener doesn't
  // also process the next callback (see cancelInFlight comment above).
  if (cancelInFlight) {
    breadcrumb('cancel_prior_in_flight', { provider })
    cancelInFlight()
    cancelInFlight = null
  }

  breadcrumb('request_oauth_url', { provider })

  // Get the OAuth URL from Supabase without auto-opening the browser
  const scopes = scopesFor(provider)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: 'hockia://auth/callback',
      skipBrowserRedirect: true,
      ...(scopes ? { scopes } : {}),
    },
  })

  if (error || !data.url) {
    const failure = error || new Error('Failed to get OAuth URL')
    reportAuthFlowError('native_oauth.get_url', failure, { provider })
    throw failure
  }

  logger.debug('[nativeOAuth] Opening OAuth URL in in-app browser')
  breadcrumb('browser_open', { provider })

  // Set up a listener for when the app receives the callback URL
  const authPromise = new Promise<void>((resolve, reject) => {
    let resolved = false
    const cleanup = () => {
      resolved = true
      clearTimeout(timeoutId)
      listenerHandle.then(h => h.remove())
      // Clear the module-level handle if we're still the current attempt.
      // Guarded so a later attempt that already replaced cancelInFlight
      // doesn't get its handle wiped by ours.
      if (cancelInFlight === cleanup) cancelInFlight = null
    }
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup()
        const timeoutErr = new Error('OAuth timed out after 5 minutes')
        reportAuthFlowError('native_oauth.timeout', timeoutErr, { provider })
        reject(timeoutErr)
      }
    }, 5 * 60 * 1000) // 5 minute timeout

    // Expose this attempt's cleanup to the module so a fresh
    // signInWithOAuthNative() can cancel us before adding its own listener.
    cancelInFlight = () => {
      if (resolved) return
      cleanup()
      const cancelErr = new Error('OAuth cancelled — superseded by a newer sign-in attempt')
      cancelErr.name = 'OAuthCancelled'
      reject(cancelErr)
    }

    const listenerHandle = App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      const url = event.url
      logger.debug('[nativeOAuth] Received URL:', url)

      // Check if this is our auth callback
      if (!url.includes('auth/callback')) return
      // Don't double-process if a newer attempt already cancelled us.
      if (resolved) return

      cleanup()

      try {
        // Close the in-app browser
        await Browser.close()
      } catch {
        // Browser may already be closed
      }

      try {
        // Parse the URL to extract auth params
        const urlObj = new URL(url)

        breadcrumb('callback_received', { provider, hasCode: !!urlObj.searchParams.get('code'), hasHash: !!url.split('#')[1] })

        // Check for PKCE code (query param)
        const code = urlObj.searchParams.get('code')
        if (code) {
          breadcrumb('pkce_exchange', { provider })
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            reportAuthFlowError('native_oauth.pkce_exchange', exchangeError, { provider })
            reject(exchangeError)
            return
          }
          resolve()
          return
        }

        // Check for implicit flow tokens (hash fragment)
        const hashParams = new URLSearchParams(url.split('#')[1] || '')
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (accessToken) {
          breadcrumb('implicit_set_session', { provider })
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          if (sessionError) {
            reportAuthFlowError('native_oauth.set_session', sessionError, { provider })
            reject(sessionError)
            return
          }
          resolve()
          return
        }

        // Check for errors in callback URL (provider returned an error)
        const errorParam = urlObj.searchParams.get('error') || hashParams.get('error')
        const errorDesc = urlObj.searchParams.get('error_description') || hashParams.get('error_description')
        if (errorParam) {
          const providerErr = new Error(errorDesc || errorParam)
          providerErr.name = 'OAuthProviderError'
          reportAuthFlowError('native_oauth.provider_error', providerErr, {
            provider,
            errorCode: errorParam,
          })
          reject(providerErr)
          return
        }

        // Let Supabase auto-detect the session from URL
        // This handles edge cases where tokens are set via cookies
        breadcrumb('fallback_get_session', { provider })
        const { error: getError } = await supabase.auth.getSession()
        if (getError) {
          reportAuthFlowError('native_oauth.fallback_get_session', getError, { provider })
          reject(getError)
        } else {
          resolve()
        }
      } catch (err) {
        reportAuthFlowError('native_oauth.callback_exception', err, { provider })
        reject(err)
      }
    })
  })

  // Open the OAuth URL in SFSafariViewController (iOS) / Chrome Custom Tab (Android)
  // Must use 'fullscreen' — 'popover' on iPad prevents Universal Link interception,
  // so the auth callback never reaches the app (Apple Guideline 2.1a, iPad Air rejection)
  await Browser.open({
    url: data.url,
    presentationStyle: 'fullscreen',
  })

  return authPromise
}
