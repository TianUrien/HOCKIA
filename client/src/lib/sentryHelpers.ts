import * as Sentry from '@sentry/react'
import { detectInAppBrowser } from './inAppBrowser'

type SupabaseErrorLike = {
  message?: string
  code?: string | number
  details?: string
  hint?: string
  status?: number
}

/**
 * Recognise the "auth lifecycle" shape of a Supabase / PostgREST error:
 * a request that came back 401 because the session was being cleared
 * (manual sign-out OR onAuthStateChange-signed-out OR token-refresh
 * failure mid-flight). Examples:
 *   - PostgREST: { code: 'PGRST301', message: 'JWT expired' }
 *   - PostgREST: { message: 'JWT expired' / 'invalid JWT' / 'JWSError' }
 *   - HTTP wrapper: { status: 401 }
 *
 * These are NOT bugs — they're expected during sign-out transitions
 * and should be logged at WARN (or silently bailed) instead of ERROR
 * + Sentry capture, which spams the console + alert pipeline. Use
 * this guard before `logger.error` / `reportSupabaseError` to skip
 * the noise.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as SupabaseErrorLike
  if (e.status === 401) return true
  if (e.code === 'PGRST301' || e.code === '401') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('jwt verification') ||
    msg.includes('jwsError'.toLowerCase()) ||
    msg.includes('401')
  )
}

type ExtraMetadata = Record<string, unknown>
type TagMetadata = Record<string, string>

/**
 * Wraps a Supabase error (plain object with code/message/details/hint) in a
 * proper Error instance so Sentry displays the message instead of the
 * minified class name ("Ri", "Q", etc.).
 */
export function toSentryError(error: unknown): Error {
  if (error instanceof Error) return error

  const obj = (typeof error === 'object' && error !== null ? error : null) as SupabaseErrorLike | null
  const message = obj?.message || 'Unknown Supabase error'
  const wrapped = new Error(message)
  wrapped.name = 'SupabaseError'
  // Preserve original properties for Sentry extra context
  ;(wrapped as unknown as Record<string, unknown>).__raw = error
  return wrapped
}

/**
 * Gets in-app browser context for Sentry reporting
 */
function getInAppBrowserContext(): Record<string, string | boolean> {
  const browserInfo = detectInAppBrowser()
  return {
    isInAppBrowser: browserInfo.isInAppBrowser,
    inAppBrowserName: browserInfo.browserName ?? 'none',
  }
}

/**
 * Sets up global Sentry context with in-app browser information
 * Call this once during app initialization
 */
export function initSentryInAppBrowserContext(): void {
  const browserInfo = detectInAppBrowser()
  
  if (browserInfo.isInAppBrowser) {
    Sentry.setTag('in_app_browser', browserInfo.browserName ?? 'unknown')
    Sentry.setContext('browser_environment', {
      isInAppBrowser: true,
      browserName: browserInfo.browserName,
      canOpenInExternalBrowser: browserInfo.canOpenInExternalBrowser,
      suggestedAction: browserInfo.suggestedAction,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    })
  } else {
    Sentry.setTag('in_app_browser', 'none')
  }
}

export function reportSupabaseError(
  scope: string,
  error: unknown,
  extras: ExtraMetadata = {},
  tags: TagMetadata = {}
) {
  // Centralised auth-lifecycle skip: 401s racing against sign-out are
  // expected, not bugs. Bailing here prevents EVERY callsite (every
  // hook + page) from polluting Sentry without each having to add
  // its own guard. The auth store handles the actual sign-out + UX.
  if (isAuthExpiredError(error)) return

  const supabaseError = (typeof error === 'object' && error !== null ? error : undefined) as SupabaseErrorLike | undefined
  const browserContext = getInAppBrowserContext()

  Sentry.captureException(toSentryError(error), {
    tags: {
      scope,
      isSupabase: true,
      ...browserContext,
      ...tags,
    },
    extra: {
      supabaseCode: supabaseError?.code,
      supabaseDetails: supabaseError?.details,
      supabaseHint: supabaseError?.hint,
      ...extras,
    },
  })
}

/**
 * Reports an auth flow error with in-app browser context
 * Use this for auth-specific errors where in-app browser detection is especially relevant
 */
export function reportAuthFlowError(
  stage: string,
  error: unknown,
  extras: ExtraMetadata = {}
) {
  const browserContext = getInAppBrowserContext()

  Sentry.captureException(toSentryError(error), {
    tags: {
      feature: 'auth_flow',
      stage,
      ...browserContext,
    },
    extra: {
      ...extras,
      browserEnvironment: browserContext,
    },
  })
}
