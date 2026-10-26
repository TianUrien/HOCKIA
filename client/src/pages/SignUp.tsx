import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthHeading, AuthPage, FormError, OrDivider, TermsLine } from '@/components/auth/authUi'
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
 * the flows are unchanged. Rebrand page 26 (2026-10-26): "Join Hockia",
 * providers in platform order, "or", Create with email, terms in the footer.
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
      // Back to the landing page on the web, to Welcome in the app (Welcome
      // is the app's start since rebrand page 26).
      onBack={() => navigate('/')}
      backLabel={Capacitor.isNativePlatform() ? 'Back to Welcome' : 'Back to home'}
      footerNote={<TermsLine tone="web" />}
      switchLine={
        <>
          Already a member?{' '}
          <Link to={`/signin${search}`} className={switchLink}>
            Log in
          </Link>
        </>
      }
    >
      {/* Rebrand page 26 · Join: account first, role next. */}
      <AuthHeading title="Join Hockia" subtitle="Create your account first. You’ll choose your role next." />
      <div className="mt-8 flex flex-col gap-3">
        <FormError>{error}</FormError>
        <OAuthButtons intent="signup" next={next} onError={setError} appearance="web" />
        <OrDivider />
        <button
          type="button"
          onClick={() => navigate(`/signup/email${search}`)}
          className={webButtonClassName({ variant: 'secondary', size: 'large', block: true })}
        >
          Create with email
        </button>
      </div>
    </AuthPage>
  )
}
