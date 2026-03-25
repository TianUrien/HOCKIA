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
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { supabase } from './supabase'
import { logger } from './logger'

/** Returns true when running inside Capacitor native shell. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

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

  // Get the OAuth URL from Supabase without auto-opening the browser
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: 'https://inhockia.com/auth/callback',
      skipBrowserRedirect: true,
    },
  })

  if (error || !data.url) {
    throw error || new Error('Failed to get OAuth URL')
  }

  logger.debug('[nativeOAuth] Opening OAuth URL in in-app browser')

  // Set up a listener for when the app receives the callback URL
  const authPromise = new Promise<void>((resolve, reject) => {
    let resolved = false
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        listenerHandle.then(h => h.remove())
        reject(new Error('OAuth timed out after 5 minutes'))
      }
    }, 5 * 60 * 1000) // 5 minute timeout

    const listenerHandle = App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      const url = event.url
      logger.debug('[nativeOAuth] Received URL:', url)

      // Check if this is our auth callback
      if (!url.includes('auth/callback')) return

      resolved = true
      clearTimeout(timeoutId)
      listenerHandle.then(h => h.remove())

      try {
        // Close the in-app browser
        await Browser.close()
      } catch {
        // Browser may already be closed
      }

      try {
        // Parse the URL to extract auth params
        const urlObj = new URL(url)

        // Check for PKCE code (query param)
        const code = urlObj.searchParams.get('code')
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
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
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          if (sessionError) {
            reject(sessionError)
            return
          }
          resolve()
          return
        }

        // Check for errors
        const errorParam = urlObj.searchParams.get('error') || hashParams.get('error')
        const errorDesc = urlObj.searchParams.get('error_description') || hashParams.get('error_description')
        if (errorParam) {
          reject(new Error(errorDesc || errorParam))
          return
        }

        // Let Supabase auto-detect the session from URL
        // This handles edge cases where tokens are set via cookies
        const { error: getError } = await supabase.auth.getSession()
        if (getError) {
          reject(getError)
        } else {
          resolve()
        }
      } catch (err) {
        reject(err)
      }
    })
  })

  // Open the OAuth URL in SFSafariViewController (iOS) / Chrome Custom Tab (Android)
  // width/height required for iPad popover presentation (Apple Guideline 2.1a)
  await Browser.open({
    url: data.url,
    presentationStyle: 'popover',
    width: 600,
    height: 800,
    windowName: '_self',
  })

  return authPromise
}
