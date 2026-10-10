import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthHeading, AuthPage, FormError, TermsLine } from '@/components/auth/authUi'
import { switchLink } from '@/components/auth/authClasses'
import { webButtonClassName } from '@/components/ui/buttonClasses'
import { useAuthStore } from '@/lib/auth'
import { isSafeRedirectPath } from '@/lib/safeRedirect'

/**
 * First run — OAuth first (Figma "Landing v3" Sign up 127:2261 desktop /
 * 127:2304 phone, approved 6 Oct 2026). Account-first onboarding (founder
 * rulings 2026-10-03): the account is created BEFORE any role or profile
 * question. Continue with Apple / Google round-trip through /auth/callback
 * and land on "Choose your role"; "Create with email" goes to the email +
 * password screen; members log in at /signin.
 *
 * No role is picked here any more — SignUp used to open with five role cards
 * (that step now lives in components/onboarding/ChooseRoleScreen, shown once
 * the account exists). Layout and styling follow the web spec (AuthPage);
 * the flows and the copy are unchanged.
 */
export default function SignUp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, loading: authLoading } = useAuthStore()
  const [error, setError] = useState<string | null>(null)

  const nextParam = new URLSearchParams(location.search).get('next')
  const next = nextParam && isSafeRedirectPath(nextParam) ? nextParam : null
  const search = next ? `?next=${encodeURIComponent(next)}` : ''

  // A signed-in visitor has nothing to do here: members go on to the app,
  // accounts still in onboarding go back to it.
  useEffect(() => {
    if (authLoading || !user) return
    navigate(profile?.onboarding_completed ? next ?? '/dashboard/profile' : '/complete-profile', { replace: true })
  }, [authLoading, user, profile?.onboarding_completed, navigate, next])

  return (
    <AuthPage
      // On the web the chevron goes back to the landing page; in the native
      // app this screen is the start, so there is nothing to go back to.
      onBack={Capacitor.isNativePlatform() ? undefined : () => navigate('/')}
      backLabel="Back to home"
      switchLine={
        <>
          Already a member?{' '}
          <Link to={`/signin${search}`} className={switchLink}>
            Log in
          </Link>
        </>
      }
    >
      <AuthHeading title="Your game. Your network." subtitle="Free for players, coaches, clubs, umpires and brands." />
      <div className="mt-6 flex flex-col gap-4">
        <FormError>{error}</FormError>
        <OAuthButtons intent="signup" next={next} onError={setError} appearance="web" />
        <button
          type="button"
          onClick={() => navigate(`/signup/email${search}`)}
          className={webButtonClassName({ variant: 'secondary', size: 'large', block: true })}
        >
          Create with email
        </button>
        {/* Founder ruling 2026-10-03: the standard line sits under the actions
            it governs, so the OAuth path sees it too. */}
        <TermsLine tone="web" />
      </div>
    </AuthPage>
  )
}
