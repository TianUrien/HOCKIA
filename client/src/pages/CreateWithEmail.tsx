import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { Eye, EyeOff } from 'lucide-react'
import { AuthShell, FormError, TermsLine, authInput, authLabel } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { getAuthRedirectUrl } from '@/lib/siteUrl'
import { getAttributionSnapshot } from '@/lib/attribution'
import { checkSignupRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { trackSignUp, trackSignUpStart } from '@/lib/analytics'
import { stashRedirectIntent } from '@/lib/redirectIntent'
import { isSafeRedirectPath } from '@/lib/safeRedirect'
import { extractErrorMessage } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/onboardingV2'

/**
 * Create with email (Figma 04 Player 114:434): email, password ("At least 8
 * characters"), Continue, Terms line. The role is NOT chosen here — it comes
 * after the account exists ("Choose your role"), and the date of birth is
 * asked in Set up step 1 where the existing server gate
 * (declare_date_of_birth) decides. The auth metadata therefore carries only
 * the attribution snapshot.
 *
 * Funnel (unchanged semantic points): `sign_up_start` (label "email") when
 * the form is submitted, `sign_up` once the account exists. The label of
 * `sign_up` used to be the role; it is "pending_role" now because the role is
 * chosen later (`role_selected` fires for every account at that point).
 */
export default function CreateWithEmail() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextParam = new URLSearchParams(location.search).get('next')
  const next = nextParam && isSafeRedirectPath(nextParam) ? nextParam : null
  const search = next ? `?next=${encodeURIComponent(next)}` : ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter your email.')
      return
    }
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    setLoading(true)
    try {
      const rateLimit = await checkSignupRateLimit(trimmed)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        return
      }
      trackSignUpStart('email')
      const acq = getAttributionSnapshot()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: { ...(acq ? { acq } : {}) },
        },
      })
      if (signUpError) {
        Sentry.captureException(signUpError, {
          tags: { feature: 'auth_flow' },
          extra: { payload: { emailDomain: trimmed.split('@')[1] ?? null } },
        })
        if (/already.registered|already.exists/i.test(signUpError.message)) {
          setError('This email is already registered. Try logging in instead.')
          return
        }
        if (/validate email|invalid format|invalid email/i.test(signUpError.message)) {
          setError('That email address doesn’t look right — please check it.')
          return
        }
        setError(extractErrorMessage(signUpError, 'Sign up failed. Please try again.'))
        return
      }
      if (!data.user) {
        setError('No user data returned from signup.')
        return
      }
      trackSignUp('pending_role')
      // VerifyEmail reads the address back to say where the link went.
      try {
        localStorage.setItem('pending_email', trimmed)
      } catch {
        /* noop */
      }
      stashRedirectIntent(next)
      navigate('/verify-email')
    } catch (err) {
      logger.error('Sign up error:', err)
      setError(extractErrorMessage(err, 'Sign up failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell back={{ parent: 'Start', onBack: () => navigate(`/signup${search}`) }} title="Create with email">
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col pt-4">
        <div className="space-y-4">
          <div>
            <label htmlFor="signup-email" className={authLabel}>Email</label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={authInput}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="signup-password" className={authLabel}>Password</label>
            <div className="relative">
              <input
                id="signup-password"
                type={shown ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${authInput} pr-12`}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                aria-describedby="signup-password-help"
                required
              />
              <button
                type="button"
                onClick={() => setShown((v) => !v)}
                aria-label={shown ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-3"
              >
                {shown ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p id="signup-password-help" className="mt-1.5 text-caption text-ink-3">At least {PASSWORD_MIN_LENGTH} characters</p>
          </div>
          <FormError>{error}</FormError>
        </div>
        <div className="mt-auto space-y-3 pt-8">
          <Button type="submit" block loading={loading} disabled={!email.trim() || !password}>
            Continue
          </Button>
          <TermsLine />
        </div>
      </form>
    </AuthShell>
  )
}
