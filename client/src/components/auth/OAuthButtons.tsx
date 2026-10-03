import { useState } from 'react'
import { startOAuthSignIn, type OAuthProvider } from '@/lib/oauthSignIn'
import { supportsReliableOAuth } from '@/lib/inAppBrowser'
import { stashRedirectIntent } from '@/lib/redirectIntent'
import { trackLogin, trackSignUpStart } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { SocialButton } from '@/components/ui/SocialButton'

/**
 * "Continue with Apple" / "Continue with Google" — the fast path on First run
 * (Figma 104:2096) and Log in (114:477), drawn with Button / Social
 * (535:8381): Large 48, radius 12, Apple first per HIG. In sign-up the role is NOT chosen here (account-first onboarding,
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
      <SocialButton provider="apple" onClick={() => start('apple')}>
        Continue with Apple
      </SocialButton>
      <SocialButton provider="google" onClick={() => start('google')}>
        Continue with Google
      </SocialButton>
      {warning && (
        <p className="rounded-[12px] bg-status-warning-soft px-3.5 py-2.5 text-secondary text-status-warning" role="alert">
          {warning}
        </p>
      )}
    </div>
  )
}
