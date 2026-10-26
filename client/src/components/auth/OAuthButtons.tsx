import { useState } from 'react'
import { startOAuthSignIn, type OAuthProvider } from '@/lib/oauthSignIn'
import { detectInAppBrowser, supportsOAuthProvider } from '@/lib/inAppBrowser'
import { useFacebookLoginEnabled } from '@/hooks/useFacebookLoginEnabled'
import { stashRedirectIntent } from '@/lib/redirectIntent'
import { trackLogin, trackSignUpStart } from '@/lib/analytics'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { SocialButton } from '@/components/ui/SocialButton'
import { ContinueInBrowser } from './ContinueInBrowser'
import { getRuntimePlatform } from '@/lib/appVersion'

/** Rebrand page 26: Apple first in the iOS app (HIG); Google first on Android and the web. */
const providerOrder: Array<'apple' | 'google'> = getRuntimePlatform() === 'ios-native' ? ['apple', 'google'] : ['google', 'apple']

/**
 * "Continue with Apple" / "Continue with Google" — the fast path on First run
 * (Figma 104:2096) and Log in (114:477), drawn with Button / Social
 * (535:8381). Order (rebrand page 26): Apple first in the iOS app per HIG,
 * Google first on Android and the web. In sign-up the role is NOT chosen here (account-first onboarding,
 * founder rulings 2026-10-03): nothing is stashed in localStorage; the role is
 * asked on "Choose your role" once the account exists, so an OAuth return
 * always lands there via /auth/callback → /complete-profile.
 *
 * Funnel: sign-up fires `sign_up_start` (label = provider) at the tap, sign-in
 * fires `login` — the same semantic points as before.
 *
 * Inside Instagram / Facebook / other in-app browsers Google refuses to sign
 * anyone in, so tapping Google there opens ContinueInBrowser (hand the page to
 * Safari / Chrome) instead of a round-trip that ends on Google's "This browser
 * or app may not be secure" page. Apple and email carry on in place.
 */

interface OAuthButtonsProps {
  intent: 'signup' | 'signin'
  /** Validated `?next=` to preserve across the round-trip. */
  next?: string | null
  onError: (message: string) => void
  className?: string
  /** 'web' = Landing v3 pills (Figma 127:2141); default = the app cut. */
  appearance?: 'app' | 'web'
}

export function OAuthButtons({ intent, next, onError, className, appearance = 'app' }: OAuthButtonsProps) {
  const showFacebook = useFacebookLoginEnabled()
  const [handoff, setHandoff] = useState<{ browserName: string | null; provider: 'Google' | 'Facebook' } | null>(null)

  const start = (provider: OAuthProvider) => {
    if (!supportsOAuthProvider(provider)) {
      setHandoff({ browserName: detectInAppBrowser().browserName, provider: provider === 'facebook' ? 'Facebook' : 'Google' })
      return
    }
    setHandoff(null)
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
    <div className={cn(appearance === 'web' ? 'space-y-4' : 'space-y-3', className)}>
      {providerOrder.map((provider) => (
        <SocialButton key={provider} provider={provider} appearance={appearance} onClick={() => start(provider)}>
          {provider === 'apple' ? 'Continue with Apple' : 'Continue with Google'}
        </SocialButton>
      ))}
      {showFacebook && (
        <SocialButton provider="facebook" appearance={appearance} onClick={() => start('facebook')}>
          Continue with Facebook
        </SocialButton>
      )}
      {handoff && <ContinueInBrowser browserName={handoff.browserName} providerLabel={handoff.provider} />}
    </div>
  )
}
