/**
 * Cross-platform OAuth sign-in handler.
 *
 * On web: Uses standard Supabase OAuth (opens in same window/tab).
 * On native (Capacitor): Uses in-app browser (SFSafariViewController/Chrome Custom Tab)
 * with deep link callback handling.
 */
import * as Sentry from '@sentry/react'
import { isNativePlatform, signInWithOAuthNative } from './nativeOAuth'
import { supabase } from './supabase'
import { getAuthRedirectUrl } from './siteUrl'
import { logger } from './logger'
import { reportAuthFlowError } from './sentryHelpers'

export type OAuthProvider = 'apple' | 'google'

/**
 * Initiate OAuth sign-in with the given provider.
 * Automatically uses the correct flow for web vs native.
 */
export async function startOAuthSignIn(provider: OAuthProvider): Promise<void> {
  const platform = isNativePlatform() ? 'native' : 'web'
  Sentry.setTag('auth_provider', provider)
  Sentry.setTag('auth_platform', platform)
  Sentry.addBreadcrumb({
    category: 'auth',
    type: 'user',
    level: 'info',
    message: `oauth.start.${provider}`,
    data: { provider, platform },
  })

  try {
    if (platform === 'native') {
      logger.debug(`[oauthSignIn] Starting native OAuth for ${provider}`)
      await signInWithOAuthNative(provider)
      return
    }

    // Standard web OAuth — Supabase handles the redirect
    logger.debug(`[oauthSignIn] Starting web OAuth for ${provider}`)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getAuthRedirectUrl() },
    })
    if (error) throw error
  } catch (err) {
    reportAuthFlowError('oauth_start', err, { provider, platform })
    throw err
  }
}
