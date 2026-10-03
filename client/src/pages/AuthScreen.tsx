/**
 * AuthScreen — Log in (Figma 04 Player 114:477). OAuth first (Apple top per
 * HIG), then the email form as the fallback — visible immediately, because a
 * returning member with a password wants the field without an extra tap —
 * with "Forgot password?" and the magic-link alternative.
 *
 * Sign-up no longer lives here: the account-first flow (founder rulings
 * 2026-10-03) is /signup (First run) → /signup/email (Create with email) →
 * Choose your role → Set up. This screen is sign-in only.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { InAppBrowserWarning } from '@/components'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { fieldInput, fieldLabel, fieldLabelText } from '@/components/ui/fieldClasses'
import { supabase } from '@/lib/supabase'
import { sendMagicLink } from '@/lib/magicLink'
import { checkLoginRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { useAuthStore } from '@/lib/auth'
import { trackLogin, trackLoginFailed } from '@/lib/analytics'
import { reportAuthFlowError } from '@/lib/sentryHelpers'
import { isSafeRedirectPath } from '@/lib/safeRedirect'
import { clearRedirectIntent, stashRedirectIntent } from '@/lib/redirectIntent'

const RESEND_COOLDOWN_SECONDS = 60

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

  const back = {
    parent: 'Start',
    onBack: () => {
      if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1)
      else navigate('/')
    },
  }

  // ── Sent state ──
  if (sentTo) {
    return (
      <AuthShell back={back} title="Log in">
        <div className="flex flex-1 flex-col items-center pt-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-positive-soft text-positive">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-title text-ink-1">Check your inbox</h1>
          <p className="mt-2 text-row text-ink-2">We sent a sign-in link to</p>
          <p className="mt-0.5 break-all text-row font-semibold text-ink-1">{sentTo}</p>
          <p className="mt-4 text-caption text-ink-3">Tap the link in the email to continue. It expires in 1 hour.</p>
          <div className="mt-4 w-full"><FormError>{error}</FormError></div>
          <div className="mt-6 flex items-center gap-4 text-row">
            <button type="button" onClick={handleResendLink} disabled={cooldown > 0 || loading} className="h-11 font-semibold text-hockia-primary disabled:opacity-40">
              {cooldown > 0 ? `Resend in ${cooldown}s` : loading ? 'Resending…' : 'Resend link'}
            </button>
            <span className="text-ink-4">·</span>
            <button type="button" onClick={() => { setSentTo(null); setCooldown(0); setError(null) }} className="h-11 font-medium text-ink-2">
              Use a different email
            </button>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell back={back} title="Log in">
      <InAppBrowserWarning context="login" />
      <div className="pt-6">
        <h1 className="text-title text-ink-1">Welcome back</h1>
      </div>

      <div className="mt-6">
        <OAuthButtons intent="signin" next={next} onError={setError} />
      </div>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-line" /></div>
        <div className="relative flex justify-center"><span className="bg-white px-3 text-caption font-semibold text-ink-3">or</span></div>
      </div>

      <form onSubmit={passwordMode ? handlePasswordSignIn : handleSendMagicLink} noValidate className="flex flex-1 flex-col">
        <div className="space-y-4">
          <div>
            <label htmlFor="auth-email" className={fieldLabel}>Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldInput}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              required
            />
          </div>

          {passwordMode && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="auth-password" className={fieldLabelText}>Password</label>
                <Link to="/forgot-password" className="text-secondary font-semibold text-hockia-primary">Forgot password?</Link>
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  type={shown ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${fieldInput} pr-12`}
                  autoComplete="current-password"
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
            </div>
          )}

          {error && !userNotFound && <FormError>{error}</FormError>}
          {userNotFound && (
            <div className="rounded-[12px] bg-surface-grouped px-3.5 py-3" role="alert">
              <p className="text-secondary font-semibold text-ink-1">No account found for this email.</p>
              <Link to={`/signup${search}`} className="mt-1 inline-block text-secondary font-semibold text-hockia-primary">Create an account</Link>
            </div>
          )}

          <Button type="submit" block loading={loading} disabled={!email.trim() || (passwordMode && !password)}>
            {passwordMode ? 'Log in' : 'Email me a sign-in link'}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => { setPasswordMode((m) => !m); setError(null); setUserNotFound(false) }}
              className="h-11 text-secondary font-semibold text-ink-2"
            >
              {passwordMode ? 'Email me a link instead' : 'Use a password instead'}
            </button>
          </div>
        </div>

        <p className="mt-auto pt-8 text-center text-row text-ink-2">
          New to HOCKIA?{' '}
          <Link to={`/signup${search}`} className="font-semibold text-hockia-primary">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  )
}
