import { useState } from 'react'
import { startOAuthSignIn, type OAuthProvider } from '@/lib/oauthSignIn'
import { supportsReliableOAuth } from '@/lib/inAppBrowser'
import { stashRedirectIntent } from '@/lib/redirectIntent'
import { trackLogin, trackSignUpStart } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/**
 * "Continue with Apple" / "Continue with Google" — the fast path on First run
 * (Figma 104:2096) and Log in (114:477). Apple first per HIG. Large 48, 44 pt
 * targets. In sign-up the role is NOT chosen here (account-first onboarding,
 * founder rulings 2026-10-03): nothing is stashed in localStorage; the role is
 * asked on "Choose your role" once the account exists, so an OAuth return
 * always lands there via /auth/callback → /complete-profile.
 *
 * Funnel: sign-up fires `sign_up_start` (label = provider) at the tap, sign-in
 * fires `login` — the same semantic points as before.
 */
const OAUTH_WARNING =
  'This browser may not support Google or Apple sign-in. Please use email below, or open HOCKIA in Safari or Chrome.'

interface OAuthButtonsProps {
  intent: 'signup' | 'signin'
  /** Validated `?next=` to preserve across the round-trip. */
  next?: string | null
  onError: (message: string) => void
  className?: string
}

export function OAuthButtons({ intent, next, onError, className }: OAuthButtonsProps) {
  const [warning, setWarning] = useState<string | null>(null)

  const start = (provider: OAuthProvider) => {
    if (!supportsReliableOAuth()) {
      setWarning(OAUTH_WARNING)
      return
    }
    setWarning(null)
    stashRedirectIntent(next)
    if (intent === 'signin') trackLogin(provider)
    else trackSignUpStart(provider)
    startOAuthSignIn(provider).catch((err) => {
      // A superseded attempt (user tapped again while the first one was
      // still opening) is not a failure — the newer attempt is in flight.
      if (err instanceof Error && err.name === 'OAuthCancelled') return
      logger.error(`${provider} OAuth error:`, err)
      onError('Sign-in failed. Please try again.')
    })
  }

  return (
    <div className={cn('space-y-3', className)}>
      <button
        type="button"
        onClick={() => start('apple')}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-surface-inverse text-body font-semibold text-white active:opacity-90"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
        Continue with Apple
      </button>
      <button
        type="button"
        onClick={() => start('google')}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-white text-body font-semibold text-ink-1 ring-1 ring-inset ring-line active:bg-surface-muted"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Continue with Google
      </button>
      {warning && (
        <p className="rounded-[12px] bg-status-warning-soft px-3.5 py-2.5 text-secondary text-status-warning" role="alert">
          {warning}
        </p>
      )}
    </div>
  )
}
