/**
 * Cross-platform OAuth sign-in handler.
 *
 * On web: Uses standard Supabase OAuth (opens in same window/tab).
 * On native (Capacitor): Uses in-app browser (SFSafariViewController/Chrome Custom Tab)
 * with deep link callback handling.
 */
import { isNativePlatform, signInWithOAuthNative } from './nativeOAuth'
import { supabase } from './supabase'
import { getAuthRedirectUrl } from './siteUrl'
import { logger } from './logger'

export type OAuthProvider = 'apple' | 'google'

/**
 * Initiate OAuth sign-in with the given provider.
 * Automatically uses the correct flow for web vs native.
 */
export async function startOAuthSignIn(provider: OAuthProvider): Promise<void> {
  if (isNativePlatform()) {
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
}
