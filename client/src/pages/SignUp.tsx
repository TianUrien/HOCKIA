import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { InAppBrowserWarning } from '@/components'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/auth'
import { isSafeRedirectPath } from '@/lib/safeRedirect'

/**
 * First run — OAuth first (Figma 04 Player 104:2096). Account-first
 * onboarding (founder rulings 2026-10-03): the account is created BEFORE any
 * role or profile question. Continue with Apple / Google round-trip through
 * /auth/callback and land on "Choose your role"; "Create with email" goes to
 * the email + password screen; members log in at /signin.
 *
 * No role is picked here any more — SignUp used to open with five role cards
 * (that step now lives in components/onboarding/ChooseRoleScreen, shown once
 * the account exists). Desktop renders the same centred column.
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
    <AuthShell>
      <InAppBrowserWarning context="signup" />
      <div className="flex flex-1 flex-col justify-end pb-6 pt-10">
        <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" className="h-7 w-auto self-start" />
        <h1 className="mt-8 text-large-title text-ink-1">Your game. Your network.</h1>
      </div>
      <div className="space-y-3 pb-2">
        <FormError>{error}</FormError>
        <OAuthButtons intent="signup" next={next} onError={setError} />
        <Button variant="secondary" block onClick={() => navigate(`/signup/email${search}`)}>
          Create with email
        </Button>
        <p className="pt-3 text-center text-row text-ink-2">
          Already a member?{' '}
          <Link to={`/signin${search}`} className="font-semibold text-hockia-primary">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
