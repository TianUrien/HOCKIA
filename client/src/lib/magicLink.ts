/**
 * Magic-link (passwordless) sign-in.
 *
 * Works everywhere — including Meta / in-app WebViews where Google and
 * Apple OAuth are blocked by provider policy (disallowed_useragent). The
 * user enters their email, we send a one-time link via Supabase, they
 * tap it in their inbox, the link opens in the system browser, Supabase
 * exchanges the code, and AuthCallback.tsx finishes the login.
 *
 * For new signups the `role` arg is written into user_metadata so that
 * auth.ts's placeholder-profile insert knows which role to seed; for
 * existing-user sign-in, role is omitted and the user's existing profile
 * is loaded.
 */
import * as Sentry from '@sentry/react'
import { supabase } from './supabase'
import { getAuthRedirectUrl } from './siteUrl'
import { checkLoginRateLimit, checkSignupRateLimit, formatRateLimitError } from './rateLimit'
import { logger } from './logger'
import { reportAuthFlowError } from './sentryHelpers'

export type MagicLinkRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

export type MagicLinkIntent = 'signin' | 'signup'

export interface SendMagicLinkOptions {
  email: string
  /** Role for new signups. Omit (or use intent='signin') for existing-user sign-in. */
  role?: MagicLinkRole
  /**
   * 'signin' = existing user logging in. Supabase will NOT create a new
   * account if the email doesn't exist (prevents silent account creation
   * from email typos on the Landing page), and uses the LOGIN rate-limit
   * bucket so it's accounted separately from signup abuse.
   *
   * 'signup' = brand-new user. Supabase creates the account (default
   * behavior) and writes the role into user_metadata so the auth store
   * can seed a placeholder profile. Uses the SIGNUP rate-limit bucket.
   */
  intent: MagicLinkIntent
}

export interface SendMagicLinkResult {
  ok: boolean
  /** Human-readable error message if ok=false. */
  error?: string
  /** True when the user was blocked by rate limiting (UI should show cooldown). */
  rateLimited?: boolean
  /** True when intent='signin' but no account exists for this email. */
  userNotFound?: boolean
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function sendMagicLink(options: SendMagicLinkOptions): Promise<SendMagicLinkResult> {
  const email = options.email.trim().toLowerCase()
  const role = options.role
  const intent = options.intent
  const shouldCreateUser = intent === 'signup'

  if (!email || !isValidEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }

  Sentry.addBreadcrumb({
    category: 'auth',
    type: 'user',
    level: 'info',
    message: 'magic_link.start',
    data: { emailDomain: email.split('@')[1] ?? null, hasRole: !!role, intent },
  })

  // Signin intent → login rate-limit bucket (shared with password login
  // on Landing), signup intent → signup rate-limit bucket (shared with
  // email+password signup). Sharing buckets per-intent prevents an
  // attacker from using one auth method to bypass the other's limits.
  const rateLimit = intent === 'signin'
    ? await checkLoginRateLimit(email)
    : await checkSignupRateLimit(email)
  if (rateLimit && !rateLimit.allowed) {
    return { ok: false, rateLimited: true, error: formatRateLimitError(rateLimit) }
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
        shouldCreateUser,
        // data is written to user_metadata on FIRST sign-in only (existing
        // users keep their metadata), which is exactly what we want —
        // role shouldn't overwrite on re-login.
        ...(role ? { data: { role } } : {}),
      },
    })

    if (error) {
      // Supabase returns a specific error when shouldCreateUser=false and
      // no account exists. Surface this distinctly so the UI can offer a
      // "Sign up instead?" CTA rather than a generic failure.
      // Ref: https://github.com/supabase/auth-js error codes
      const message = (error.message || '').toLowerCase()
      const userNotFound =
        intent === 'signin' && (
          message.includes('signups not allowed') ||
          message.includes('user not found') ||
          message.includes('otp_disabled') ||
          error.status === 422
        )
      if (userNotFound) {
        return {
          ok: false,
          userNotFound: true,
          error: 'No account found for this email. Want to sign up instead?',
        }
      }

      reportAuthFlowError('magic_link.send', error, {
        emailDomain: email.split('@')[1] ?? null,
        hasRole: !!role,
        intent,
      })
      return { ok: false, error: 'Could not send the link. Please try again.' }
    }

    logger.debug('[magicLink] Link sent', { emailDomain: email.split('@')[1], intent })
    return { ok: true }
  } catch (err) {
    reportAuthFlowError('magic_link.send', err, {
      emailDomain: email.split('@')[1] ?? null,
      hasRole: !!role,
      intent,
    })
    return { ok: false, error: 'Could not send the link. Please try again.' }
  }
}
