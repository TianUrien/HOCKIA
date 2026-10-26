import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthShell } from '@/components/auth/authUi'
import { AlertTriangle, Mail } from 'lucide-react'
import ResendVerificationButton from '@/components/ResendVerificationButton'
import { detectInAppBrowser } from '@/lib/inAppBrowser'

/**
 * VerifyEmail - Handles all email verification states
 * 
 * States:
 * 1. After sign-up: "Check your inbox"
 * 2. Unverified sign-in attempt: "Please verify your email"
 * 3. Expired/invalid link: "Link expired"
 * 4. Success (rare - usually handled by callback): "Email verified"
 */
export default function VerifyEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState<string | null>(null)
  const [browserInfo] = useState(() => detectInAppBrowser())

  const error = searchParams.get('error')
  const emailParam = searchParams.get('email')

  useEffect(() => {
    // Get email from URL param or localStorage (from signup)
    const storedEmail = emailParam || localStorage.getItem('pending_email')
    if (storedEmail) {
      setEmail(storedEmail)
    }
  }, [emailParam])

  // Determine which state to show
  const getState = () => {
    if (error === 'expired' || error === 'invalid_token') {
      return 'expired'
    }
    if (error === 'no_session' || error === 'session_failed' || error === 'exchange_failed') {
      return 'session_error'
    }
    if (searchParams.get('reason') === 'unverified_signin') {
      return 'unverified_signin'
    }
    return 'check_inbox' // Default after sign-up
  }

  const state = getState()

  const renderContent = () => {
    switch (state) {
      case 'expired':
        return (
          <>
            <div className="w-16 h-16 bg-status-warning-soft rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-status-warning" />
            </div>
            <h1 className="mb-3 text-title text-ink-1">
              Verification link invalid
            </h1>
            <p className="text-gray-600 mb-6">
              This verification link has expired or has already been used.
            </p>
          </>
        )

      case 'session_error':
        return (
          <>
            <div className="w-16 h-16 bg-status-danger-soft rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-status-danger" />
            </div>
            <h1 className="mb-3 text-title text-ink-1">
              Verification failed
            </h1>
            <p className="text-gray-600 mb-2">
              We couldn't verify your email. This usually happens when:
            </p>
            <ul className="text-left text-gray-600 mb-4 ml-6 list-disc space-y-1">
              <li>The link has already been used</li>
              <li>The link has expired (links expire after 24 hours)</li>
              <li>You clicked the link multiple times</li>
            </ul>
            <p className="text-gray-600 mb-6">
              Request a new verification email below to continue.
            </p>
          </>
        )

      case 'unverified_signin':
        return (
          <>
            <div className="w-16 h-16 bg-status-warning-soft rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-status-warning" />
            </div>
            <h1 className="mb-3 text-title text-ink-1">
              Verify your email first
            </h1>
            <p className="text-gray-600 mb-2">
              Please verify your email address before signing in.
            </p>
            {email && (
              <p className="text-gray-600 mb-6">
                We sent a verification email to: <strong>{email}</strong>
              </p>
            )}
          </>
        )

      case 'check_inbox':
      default:
        return (
          <>
            <div className="mx-auto mb-8 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-hockia-soft">
              <Mail className="h-9 w-9 text-hockia-primary" strokeWidth={1.75} />
            </div>
            <h1 className="mb-3 text-title text-ink-1">
              Check your inbox
            </h1>
            <p className="mb-6 text-[17px] leading-[22px] text-ink-2">
              We sent a confirmation link to{' '}
              {email ? <span className="font-semibold text-ink-1">{email}</span> : 'your email'}. Open it on this phone to continue.
            </p>

            {/* In-app browser (Instagram, Facebook…): the email link opens in the
                phone's own browser, not back here. That is fine — the client
                uses the implicit flow, so the link signs the member in wherever
                it opens. Say so calmly instead of warning. */}
            {browserInfo.isInAppBrowser && (
              <div className="mb-4 rounded-xl bg-gray-50 p-4 text-left ring-1 ring-inset ring-gray-200">
                <p className="text-sm font-medium text-gray-900">The link may open in Safari or Chrome</p>
                <p className="mt-1 text-sm text-gray-600">
                  That’s expected: you’ll be signed in there and can carry on. Prefer to stay here? After confirming, come back and log in with your email and password.
                </p>
              </div>
            )}
          </>
        )
    }
  }

  // Rebrand page 26 · Check your inbox: the white auth page, content centred,
  // one action at the bottom. ("Open mail app" is left out: the web and the
  // app can't open the inbox reliably; mailto: opens a new draft instead.)
  return (
    <AuthShell back={{ parent: 'Log in', onBack: () => navigate('/signin') }}>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {renderContent()}
        </div>
        <div className="space-y-4 pt-8">
          {email && <ResendVerificationButton email={email} />}
          <p className="text-center text-[15px] leading-[21px] text-ink-2">
            Wrong email?{' '}
            <Link to="/signup/email" className="font-semibold text-brand-text">Change it</Link>
          </p>
          <p className="text-center text-caption text-ink-3">Check your spam folder. Links expire after 24 hours.</p>
        </div>
      </div>
    </AuthShell>
  )
}
