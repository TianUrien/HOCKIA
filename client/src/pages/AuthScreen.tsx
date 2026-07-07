/**
 * AuthScreen — unified sign-in / sign-up surface.
 *
 * 2026-aligned UX pattern (see research memo):
 *   - OAuth row at top, Apple first per Apple HIG (top of stack, same or
 *     larger than competitors, visible without scroll).
 *   - "or" divider, then a SINGLE email field shared by both the
 *     passwordless and password paths.
 *   - Primary CTA: "Email me a sign-in link" (works in every browser,
 *     including Meta in-app WebViews where Google/Apple OAuth is blocked).
 *   - Password is progressively disclosed — one tap on "Use a password
 *     instead" replaces the text link with a password field.
 *   - Footer: a single small link for the opposite mode.
 *
 * Replaces the auth card on Landing.tsx and the step-2 email/password
 * panel on SignUp.tsx. Never renders two email inputs at once (named
 * anti-pattern — Authgear 2025 guide).
 */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { ArrowLeft, Mail, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { Input, Button } from '@/components'
import { supabase, SUPABASE_URL } from '@/lib/supabase'
import { getAuthRedirectUrl } from '@/lib/siteUrl'
import { calculateAge } from '@/lib/utils'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'
import { startOAuthSignIn } from '@/lib/oauthSignIn'
import { supportsReliableOAuth } from '@/lib/inAppBrowser'
import { sendMagicLink, type MagicLinkRole } from '@/lib/magicLink'
import { checkLoginRateLimit, checkSignupRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { trackLogin, trackLoginFailed, trackSignUp, trackSignUpStart } from '@/lib/analytics'
import { reportAuthFlowError } from '@/lib/sentryHelpers'

export interface AuthScreenProps {
  mode: 'signin' | 'signup'
  /** Required when mode='signup' — seeded into user_metadata. */
  role?: MagicLinkRole
  /** Signup back-to-role-selection handler (when embedded inside SignUp.tsx). */
  onBack?: () => void
}

type PasswordVisibility = 'hidden' | 'shown'

const RESEND_COOLDOWN_SECONDS = 60

const OAUTH_WARNING =
  'This browser may not support Google or Apple sign-in. Please use the email link below, or open HOCKIA in Safari or Chrome.'

function roleLabel(role: MagicLinkRole | undefined): string {
  switch (role) {
    case 'player':
      return 'Player'
    case 'coach':
      return 'Coach'
    case 'club':
      return 'Club'
    case 'brand':
      return 'Brand'
    case 'umpire':
      return 'Umpire'
    default:
      return ''
  }
}

export default function AuthScreen({ mode, role, onBack }: AuthScreenProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, profileStatus, loading: authLoading } = useAuthStore()

  // `?next=` preservation — passed through OAuth + magic link so users
  // who clicked "Apply to Opportunity X" return where they started.
  // Stashed into sessionStorage before any redirect away from this page
  // (OAuth or magic-link email) because the redirect round-trip loses
  // the URL query param. AuthCallback reads the stash back on return.
  const searchParams = new URLSearchParams(location.search)
  const nextParam = searchParams.get('next')

  const stashRedirectIntent = () => {
    if (!nextParam) return
    try {
      sessionStorage.setItem('hockia-redirect-after-login', nextParam)
    } catch {
      /* noop — incognito / storage-disabled browsers just lose the next param */
    }
  }

  // Single source of truth for the email field — shared by magic link
  // and password paths (the whole point of the redesign).
  const [email, setEmail] = useState('')
  // Sign-in defaults to password mode (the dominant UX expectation —
  // returning users mostly remember their password and want a familiar
  // Sign-up now also defaults to password mode — the form feels more
  // like a "real account" creation (email + password + Create Account)
  // than a one-click magic link. Users who prefer the link path still
  // have the "Email me a link instead" toggle below the submit button.
  // Applies uniformly across Player / Coach / Club / Brand / Umpire
  // since role is a separate state value, not a form-shape modifier.
  const [passwordMode, setPasswordMode] = useState(true)
  const [password, setPassword] = useState('')
  const [pwVisibility, setPwVisibility] = useState<PasswordVisibility>('hidden')

  // Unified status model.
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userNotFound, setUserNotFound] = useState(false)
  // ── Age gate (P3): DOB required at signup for person roles; 18+ operator
  //    attestation checkbox for organizations. Under-18 → block + waitlist. ──
  const [signupDob, setSignupDob] = useState('')
  const [orgAttested, setOrgAttested] = useState(false)
  const [minorBlocked, setMinorBlocked] = useState(false)
  const isPersonRole = role === 'player' || role === 'coach' || role === 'umpire'
  const isOrgRole = role === 'club' || role === 'brand'

  /**
   * Server-side gate for signup: validates the DOB / attestation BEFORE any
   * account exists. Under-18 → juniors waitlist (edge fn; anon + rate
   * limited) and the flow ends at the kind blocked screen — no account is
   * ever created. Returns true when signup may proceed.
   */
  const passesAgeGate = async (): Promise<boolean> => {
    if (isPersonRole) {
      if (!signupDob) {
        setError('Please enter your date of birth.')
        return false
      }
      const age = calculateAge(signupDob)
      if (age === null) {
        setError('That date doesn’t look right — please check it.')
        return false
      }
      if (age < 18) {
        // Fire-and-forget: the blocked screen shows regardless; the waitlist
        // write is best-effort (same email retried later is idempotent).
        fetch(`${SUPABASE_URL}/functions/v1/age-gate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'waitlist', email: email.trim().toLowerCase(), dob: signupDob }),
        }).catch(() => undefined)
        setMinorBlocked(true)
        return false
      }
    }
    if (isOrgRole && !orgAttested) {
      setError("Please confirm you're 18+ and authorized to represent this organization.")
      return false
    }
    return true
  }
  const [oauthWarning, setOauthWarning] = useState<string | null>(null)

  // Magic-link "check your inbox" state.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // ── Redirect already-authenticated users to their destination ──
  useEffect(() => {
    if (authLoading) return
    if (!user) return

    if (profile && profile.full_name) {
      const dest = nextParam || '/dashboard/profile'
      try {
        sessionStorage.removeItem('hockia-redirect-after-login')
      } catch {
        /* noop */
      }
      navigate(dest, { replace: true })
      return
    }

    // Signed in but profile incomplete
    if (profileStatus === 'missing' || profileStatus === 'loaded' || profileStatus === 'error') {
      navigate('/complete-profile', { replace: true })
    }
  }, [user, profile, profileStatus, authLoading, navigate, nextParam])

  // ── OAuth ──
  const handleOAuth = (provider: 'google' | 'apple') => {
    if (!supportsReliableOAuth()) {
      setOauthWarning(OAUTH_WARNING)
      return
    }
    setOauthWarning(null)
    stashRedirectIntent()
    // Signup-flow OAuth round-trips through Google/Apple and a Chrome Custom
    // Tab on Android — the SignUp.tsx component unmounts and its in-memory
    // `selectedRole` is gone by the time we return. Persist it (and the
    // typed email, if any) the same way the password path does at the bottom
    // of this file, so CompleteProfile's role-fallback chain can recover it.
    // Without this, Google signups land on the inline role re-picker — the
    // exact loop Vincent hit on the Android Closed Testing build.
    if (mode === 'signup' && role) {
      try {
        localStorage.setItem('pending_role', role)
        if (email) localStorage.setItem('pending_email', email)
      } catch {
        /* noop — incognito / storage-disabled */
      }
    }
    if (mode === 'signin') {
      trackLogin(provider)
    } else {
      trackSignUpStart(provider)
    }
    startOAuthSignIn(provider).catch((err) => {
      logger.error(`${provider} OAuth error:`, err)
      setError('Sign-in failed. Please try again.')
    })
  }

  // ── Magic link ──
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || cooldown > 0) return
    setError(null)
    setUserNotFound(false)
    setLoading(true)
    try {
      // Age gate applies to the magic-link SIGNUP path too (the link click
      // creates the account, so the gate must run before the send).
      if (mode === 'signup' && !(await passesAgeGate())) return
      const intent = mode === 'signin' ? 'signin' : 'signup'
      const result = await sendMagicLink({
        email,
        role: mode === 'signup' ? role : undefined,
        intent,
      })
      if (!result.ok) {
        setError(result.error ?? 'Could not send the link.')
        if (result.userNotFound) setUserNotFound(true)
        return
      }
      // Stash AFTER send succeeds (not before): if the send fails we don't
      // want a stale redirect intent polluting a later unrelated login.
      stashRedirectIntent()
      setSentTo(email.trim().toLowerCase())
      setCooldown(RESEND_COOLDOWN_SECONDS)
      if (mode === 'signup') trackSignUpStart('magic_link')
      else trackLogin('magic_link')
    } finally {
      setLoading(false)
    }
  }

  const handleResendLink = async () => {
    if (!sentTo || cooldown > 0 || loading) return
    setError(null)
    setLoading(true)
    try {
      const intent = mode === 'signin' ? 'signin' : 'signup'
      const result = await sendMagicLink({
        email: sentTo,
        role: mode === 'signup' ? role : undefined,
        intent,
      })
      if (!result.ok) {
        setError(result.error ?? 'Could not resend the link.')
        return
      }
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } finally {
      setLoading(false)
    }
  }

  // ── Password path (sign-in) ──
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

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        reportAuthFlowError('password_signin', signInError, {
          emailDomain: email.split('@')[1] ?? null,
        })
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

      trackLogin('password')
      // Auth store's onAuthStateChange will redirect via the effect above.
    } catch (err) {
      trackLoginFailed('password', 'exception')
      reportAuthFlowError('password_signin.catch', err, {
        emailDomain: email.split('@')[1] ?? null,
      })
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Password path (sign-up) ──
  const handlePasswordSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || !role) return
    setError(null)
    setLoading(true)
    try {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        setError('Password must include uppercase, lowercase, and a number.')
        return
      }

      if (!(await passesAgeGate())) return

      const rateLimit = await checkSignupRateLimit(email)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        return
      }

      trackSignUpStart('email')
      // dob / org_attested ride the auth metadata so onboarding can persist
      // them server-side (declare_date_of_birth / attest_org_operator_adult)
      // on the first authenticated load.
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            role,
            ...(isPersonRole && signupDob ? { dob: signupDob } : {}),
            ...(isOrgRole && orgAttested ? { org_attested: true } : {}),
          },
        },
      })

      if (signUpError) {
        Sentry.captureException(signUpError, {
          tags: { feature: 'auth_flow' },
          extra: { payload: { role, emailDomain: email.split('@')[1] ?? null } },
        })
        if (/already.registered|already.exists/i.test(signUpError.message)) {
          setError('This email is already registered. Try signing in instead.')
          return
        }
        setError(signUpError.message)
        return
      }

      if (!authData.user) {
        setError('No user data returned from signup.')
        return
      }

      trackSignUp(role)
      localStorage.setItem('pending_role', role)
      localStorage.setItem('pending_email', email)
      navigate('/verify-email')
    } catch (err) {
      logger.error('Sign up error:', err)
      setError(err instanceof Error ? err.message : 'Sign up failed.')
    } finally {
      setLoading(false)
    }
  }

  const isSignup = mode === 'signup'
  const heading = isSignup ? 'Create your account' : 'Welcome back'
  const subheading = isSignup
    ? role
      ? `You're joining as ${roleLabel(role)}`
      : ''
    : 'Sign in to your HOCKIA account'
  const footerPrompt = isSignup ? 'Already have an account?' : 'New to HOCKIA?'
  const footerLinkLabel = isSignup ? 'Sign in' : 'Create an account'
  const footerLinkTo = isSignup ? '/signin' : '/signup'

  // Handlers on back arrow — either parent-provided (SignUp role reset) or
  // route history. If the user landed here directly (no history, e.g. from an
  // email link), fall back to '/' instead of no-op.
  const handleBack = () => {
    if (onBack) {
      onBack()
      return
    }
    // Split the call: navigate has two overloads (delta: number) and
    // (to: To). A union arg confuses overload resolution — pick the
    // overload up front based on whether we have history to go back to.
    const canGoBack = typeof window !== 'undefined' && window.history.length > 1
    if (canGoBack) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  // ── Sent state: "Check your inbox" ──
  if (sentTo) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-gray-50 to-white flex flex-col">
        <AuthHeader onBack={handleBack} />
        <main className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
              <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your inbox</h1>
                <p className="text-sm text-gray-600 mb-1">
                  We sent a sign-in link to
                </p>
                <p className="text-sm font-semibold text-gray-900 break-words mb-6">{sentTo}</p>
                <p className="text-xs text-gray-500 mb-6">
                  Tap the link in the email to continue. It expires in 1 hour.
                </p>

                {error && (
                  <p className="text-sm text-red-600 mb-4" role="alert">
                    {error}
                  </p>
                )}

                <div className="flex items-center gap-4 text-sm">
                  <button
                    type="button"
                    onClick={handleResendLink}
                    disabled={cooldown > 0 || loading}
                    className="font-medium text-[#8026FA] hover:text-[#6B20D4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : loading ? 'Resending…' : 'Resend link'}
                  </button>
                  <span className="text-gray-300">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSentTo(null)
                      setCooldown(0)
                      setError(null)
                      setOauthWarning(null)
                    }}
                    className="font-medium text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Under-18 signup blocked: kind, no account created, waitlist saved ──
  if (minorBlocked) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-gray-50 to-white flex flex-col">
        <AuthHeader onBack={handleBack} />
        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
              <h1 className="text-2xl font-bold text-gray-900">HOCKIA is 18+ for now</h1>
              <p className="text-sm text-gray-600 mt-4 leading-relaxed">
                We&apos;re building a junior experience with the right protections
                for young players. We&apos;ve saved your spot on the waitlist —
                you&apos;ll be the first to know when it opens.
              </p>
              <p className="text-xs text-gray-400 mt-6">
                Saved for <span className="font-medium text-gray-600">{email.trim().toLowerCase()}</span>
              </p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Entry state ──
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-gray-50 to-white flex flex-col">
      <AuthHeader onBack={handleBack} />

      <main className="flex-1 flex items-center justify-center px-6 py-6">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-7 sm:p-8">
            <div className="mb-6 text-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{heading}</h1>
              {subheading && <p className="mt-1.5 text-sm text-gray-600">{subheading}</p>}
            </div>

            {/* ── OAuth row — Apple top per HIG, Google below. */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleOAuth('apple')}
                className="w-full flex items-center justify-center gap-2.5 h-12 rounded-xl bg-black text-white font-medium hover:bg-gray-900 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                Continue with Apple
              </button>
              <button
                type="button"
                onClick={() => handleOAuth('google')}
                className="w-full flex items-center justify-center gap-2.5 h-12 rounded-xl bg-white border border-gray-300 text-gray-800 font-medium hover:bg-gray-50 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              {oauthWarning && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="alert">
                  {oauthWarning}
                </p>
              )}
            </div>

            {/* ── Divider ── */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-xs text-gray-500 bg-white font-medium">or</span>
              </div>
            </div>

            {/* ── Email + primary CTA + password toggle ── */}
            <form
              onSubmit={passwordMode ? (isSignup ? handlePasswordSignUp : handlePasswordSignIn) : handleSendMagicLink}
              noValidate
              className="space-y-3"
            >
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  icon={<Mail className="w-4 h-4" />}
                  className="!h-11 !rounded-lg"
                  required
                  autoComplete="email"
                  inputMode="email"
                />
              </div>

              {passwordMode && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="auth-password" className="block text-xs font-medium text-gray-700">
                      Password
                    </label>
                    {!isSignup && (
                      <Link
                        to="/forgot-password"
                        className="text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                    <input
                      id="auth-password"
                      type={pwVisibility === 'shown' ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignup ? 'Min 8 chars, upper + lower + number' : 'Your password'}
                      className="w-full h-11 pl-10 pr-10 rounded-lg border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                      required
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                    />
                    <button
                      type="button"
                      onClick={() => setPwVisibility((v) => (v === 'shown' ? 'hidden' : 'shown'))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={pwVisibility === 'shown' ? 'Hide password' : 'Show password'}
                    >
                      {pwVisibility === 'shown' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {isSignup && isPersonRole && (
                <DateOfBirthPicker
                  label="Date of birth"
                  value={signupDob}
                  onChange={setSignupDob}
                  required
                />
              )}

              {isSignup && isOrgRole && (
                <label className="flex items-start gap-2.5 text-xs text-gray-600 leading-relaxed cursor-pointer">
                  <input
                    type="checkbox"
                    checked={orgAttested}
                    onChange={(e) => setOrgAttested(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#8026FA] focus:ring-[#8026FA]"
                  />
                  <span>
                    I confirm I am 18 or older and authorized to represent this
                    organization.
                  </span>
                </label>
              )}

              {error && !userNotFound && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}

              {userNotFound && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
                  <p className="text-sm text-amber-900 font-medium mb-1">No account found for this email.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/signup')}
                    className="text-sm text-[#8026FA] hover:text-[#6B20D4] font-semibold underline-offset-2 hover:underline"
                  >
                    Create an account →
                  </button>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full !h-12 !rounded-xl text-sm font-semibold"
                disabled={loading || !email.trim() || (passwordMode && !password)}
              >
                {loading
                  ? passwordMode
                    ? isSignup
                      ? 'Creating account…'
                      : 'Signing in…'
                    : 'Sending link…'
                  : passwordMode
                    ? isSignup
                      ? 'Create Account'
                      : 'Sign In'
                    : isSignup
                      ? 'Email me a sign-up link'
                      : 'Email me a sign-in link'}
              </Button>

              {/* ── Password toggle — progressive disclosure. */}
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setPasswordMode((m) => !m)
                    setError(null)
                    setUserNotFound(false)
                  }}
                  className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  {passwordMode ? 'Email me a link instead' : 'Use a password instead'}
                </button>
              </div>
            </form>

            {/* ── Footer: opposite-mode link. */}
            <div className="mt-6 pt-5 border-t border-gray-100 text-center">
              <p className="text-sm text-gray-600">
                {footerPrompt}{' '}
                <Link
                  to={footerLinkTo}
                  className="font-semibold text-[#8026FA] hover:text-[#6B20D4] transition-colors"
                >
                  {footerLinkLabel}
                </Link>
              </p>
            </div>
          </div>

          {isSignup && (
            <p className="mt-4 text-center text-xs text-gray-500 px-4">
              By continuing, you agree to our{' '}
              <Link to="/terms" className="underline underline-offset-2 hover:text-gray-900">
                Terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy-policy" className="underline underline-offset-2 hover:text-gray-900">
                Privacy Policy
              </Link>
              .
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Internal: lightweight top bar ──
function AuthHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="pt-5 px-5 flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>
      <Link to="/" className="text-lg font-bold text-gray-900 tracking-tight">
        HOCKIA
      </Link>
      <div className="w-16" aria-hidden="true" />
    </header>
  )
}
