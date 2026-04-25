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
 * Provider-specific OAuth scopes.
 *
 * Apple only returns the user's name (and sometimes email) on the FIRST
 * consent, and only when these scopes are requested. Omit them and every
 * Apple signup has an empty profile.full_name with no way to recover
 * (Apple will not re-send on future sign-ins). Source:
 * https://developer.apple.com/forums/thread/118209
 *
 * Google's defaults (email + profile) already cover what we need, so we
 * leave the scopes unset for Google to avoid triggering verification
 * review on any extra scope.
 */
export function scopesFor(provider: OAuthProvider): string | undefined {
  if (provider === 'apple') return 'name email'
  return undefined
}

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
    const scopes = scopesFor(provider)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getAuthRedirectUrl(),
        ...(scopes ? { scopes } : {}),
      },
    })
    if (error) throw error
  } catch (err) {
    reportAuthFlowError('oauth_start', err, { provider, platform })
    throw err
  }
}
