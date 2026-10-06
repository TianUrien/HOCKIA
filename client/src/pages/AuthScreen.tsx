/**
 * AuthScreen — Log in (Figma "Landing v3" Log in 127:2141 desktop /
 * 127:2204 phone, approved 6 Oct 2026). OAuth first (Apple top per HIG),
 * then the email form as the fallback — visible immediately, because a
 * returning member with a password wants the field without an extra tap —
 * with "Forgot password?" and the magic-link alternative.
 *
 * Behaviour, copy and the auth flows (OAuth round-trip, password, magic
 * link, `?next=` preservation, errors) are unchanged from the 04 Player
 * screen; only the layout and styling follow the web spec (AuthPage).
 *
 * Sign-up no longer lives here: the account-first flow (founder rulings
 * 2026-10-03) is /signup (First run) → /signup/email (Create with email) →
 * Choose your role → Set up. This screen is sign-in only.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { InAppBrowserWarning } from '@/components'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthHeading, AuthPage, FormError } from '@/components/auth/authUi'
import { orDivider, switchLink, webFieldInput, webFieldLabel } from '@/components/auth/authClasses'
import { webButtonClassName } from '@/components/ui/buttonClasses'
import { supabase } from '@/lib/supabase'
import { sendMagicLink } from '@/lib/magicLink'
import { checkLoginRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { useAuthStore } from '@/lib/auth'
import { trackLogin, trackLoginFailed } from '@/lib/analytics'
import { reportAuthFlowError } from '@/lib/sentryHelpers'
import { isSafeRedirectPath } from '@/lib/safeRedirect'
import { clearRedirectIntent, stashRedirectIntent } from '@/lib/redirectIntent'

const RESEND_COOLDOWN_SECONDS = 60

const PRIMARY_L = webButtonClassName({ variant: 'primary', size: 'large', block: true })
const LINK_M = webButtonClassName({ variant: 'link', size: 'medium' })

export default function AuthScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, profileStatus, loading: authLoading } = useAuthStore()

  // `?next=` preservation — passed through OAuth + magic link so members who
  // clicked "Apply to Opportunity X" return where they started.
  const nextParam = new URLSearchParams(location.search).get('next')
  const next = nextParam && isSafeRedirectPath(nextParam) ? nextParam : null
  const search = next ? `?next=${encodeURIComponent(next)}` : ''

  const [email, setEmail] = useState('')
  const [passwordMode, setPasswordMode] = useState(true)
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userNotFound, setUserNotFound] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // ── Already signed in → destination ──
  useEffect(() => {
    if (authLoading || !user) return
    if (profile && profile.full_name) {
      clearRedirectIntent()
      navigate(next || '/dashboard/profile', { replace: true })
      return
    }
    if (profileStatus === 'missing' || profileStatus === 'loaded' || profileStatus === 'error') {
      navigate('/complete-profile', { replace: true })
    }
  }, [user, profile, profileStatus, authLoading, navigate, next])

  // ── Magic link ──
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || cooldown > 0) return
    setError(null)
    setUserNotFound(false)
    setLoading(true)
    try {
      const result = await sendMagicLink({ email, intent: 'signin' })
      if (!result.ok) {
        setError(result.error ?? 'Could not send the link.')
        if (result.userNotFound) setUserNotFound(true)
        return
      }
      // Stash AFTER the send succeeds: a failed send must not leave a stale
      // redirect intent for a later unrelated login.
      stashRedirectIntent(next)
      setSentTo(email.trim().toLowerCase())
      setCooldown(RESEND_COOLDOWN_SECONDS)
      trackLogin('magic_link')
    } finally {
      setLoading(false)
    }
  }

  const handleResendLink = async () => {
    if (!sentTo || cooldown > 0 || loading) return
    setError(null)
    setLoading(true)
    try {
      const result = await sendMagicLink({ email: sentTo, intent: 'signin' })
      if (!result.ok) {
        setError(result.error ?? 'Could not resend the link.')
        return
      }
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } finally {
      setLoading(false)
    }
  }

  // ── Password ──
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const rateLimit = await checkLoginRateLimit(email)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        return
      }
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        reportAuthFlowError('password_signin', signInError, { emailDomain: email.split('@')[1] ?? null })
        if (signInError.message.toLowerCase().includes('email not confirmed')) {
          trackLoginFailed('password', 'unverified')
          navigate(`/verify-email?email=${encodeURIComponent(email)}&reason=unverified_signin`)
          return
        }
        trackLoginFailed('password', 'bad_credentials')
        setError('Incorrect email or password.')
        return
      }
      if (!data.user) {
        trackLoginFailed('password', 'no_user')
        setError('Something went wrong. Please try again.')
        return
      }
      stashRedirectIntent(next)
      trackLogin('password')
      // The auth store's onAuthStateChange redirects via the effect above.
    } catch (err) {
      trackLoginFailed('password', 'exception')
      reportAuthFlowError('password_signin.catch', err, { emailDomain: email.split('@')[1] ?? null })
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1)
    else navigate('/')
  }

  const switchLine = (
    <>
      New to HOCKIA?{' '}
      <Link to={`/signup${search}`} className={switchLink}>Create an account</Link>
    </>
  )

  // ── Sent state ──
  if (sentTo) {
    return (
      <AuthPage onBack={onBack} backLabel="Back to Start" switchLine={switchLine}>
        <div className="flex flex-1 flex-col items-center pt-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-positive-soft text-positive">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-web3-title text-ink-1">Check your inbox</h1>
          <p className="mt-2 text-[15px] leading-[21px] text-ink-2">We sent a sign-in link to</p>
          <p className="mt-0.5 break-all text-[15px] font-semibold leading-[21px] text-ink-1">{sentTo}</p>
          <p className="mt-4 text-[13px] leading-[18px] text-ink-3">Tap the link in the email to continue. It expires in 1 hour.</p>
          <div className="mt-4 w-full"><FormError>{error}</FormError></div>
          <div className="mt-6 flex items-center gap-4 text-[15px] leading-[21px]">
            <button type="button" onClick={handleResendLink} disabled={cooldown > 0 || loading} className="h-11 font-semibold text-brand-primary disabled:opacity-40">
              {cooldown > 0 ? `Resend in ${cooldown}s` : loading ? 'Resending…' : 'Resend link'}
            </button>
            <span className="text-ink-4">·</span>
            <button type="button" onClick={() => { setSentTo(null); setCooldown(0); setError(null) }} className="h-11 font-medium text-ink-2">
              Use a different email
            </button>
          </div>
        </div>
      </AuthPage>
    )
  }

  return (
    <AuthPage onBack={onBack} backLabel="Back to Start" switchLine={switchLine}>
      <InAppBrowserWarning context="login" />
      <AuthHeading title="Welcome back" subtitle="Log in to your Hockia profile." />

      <div className="mt-6">
        <OAuthButtons intent="signin" next={next} onError={setError} appearance="web" />
      </div>

      <div className={`${orDivider} my-4`} aria-hidden="true">or</div>

      <form onSubmit={passwordMode ? handlePasswordSignIn : handleSendMagicLink} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="auth-email" className={webFieldLabel}>Email</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={webFieldInput}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            required
          />
        </div>

        {passwordMode && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="auth-password" className={webFieldLabel}>Password</label>
              <Link to="/forgot-password" className={`${LINK_M} h-5`}>Forgot password?</Link>
            </div>
            <div className="relative">
              <input
                id="auth-password"
                type={shown ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${webFieldInput} pr-16`}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShown((v) => !v)}
                aria-label={shown ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex h-11 -translate-y-1/2 items-center rounded-lg px-3 text-[14px] font-semibold text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {shown ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        )}

        {error && !userNotFound && <FormError>{error}</FormError>}
        {userNotFound && (
          <div className="rounded-[12px] bg-surface-grouped px-3.5 py-3" role="alert">
            <p className="text-secondary font-semibold text-ink-1">No account found for this email.</p>
            <Link to={`/signup${search}`} className="mt-1 inline-block text-secondary font-semibold text-brand-primary">Create an account</Link>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim() || (passwordMode && !password)}
          aria-busy={loading || undefined}
          className={PRIMARY_L}
        >
          {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />}
          {passwordMode ? 'Log in' : 'Email me a sign-in link'}
        </button>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => { setPasswordMode((m) => !m); setError(null); setUserNotFound(false) }}
            className={`${LINK_M} h-11`}
          >
            {passwordMode ? 'Email me a link instead' : 'Use a password instead'}
          </button>
        </div>
      </form>
    </AuthPage>
  )
}
