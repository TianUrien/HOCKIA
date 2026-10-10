import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Verification Link Invalid
            </h1>
            <p className="text-gray-600 mb-6">
              This verification link has expired or has already been used.
            </p>
          </>
        )

      case 'session_error':
        return (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Verification Failed
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
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Email Verification Required
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
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Check Your Inbox
            </h1>
            <p className="text-gray-600 mb-2">
              We've sent a verification email to:
            </p>
            {email && (
              <p className="text-lg font-semibold text-gray-900 mb-4">
                {email}
              </p>
            )}
            <p className="text-gray-600 mb-6">
              Click the link in the email to verify your account and complete your profile.
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="text-center">
          {renderContent()}

          {/* Resend Button */}
          {email && (
            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-3">Didn't receive it?</p>
              <ResendVerificationButton email={email} />
            </div>
          )}

          {/* Back to Sign In Button */}
          <button
            onClick={() => navigate('/')}
            className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            ← Back to Sign In
          </button>

          {/* Help Text */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Make sure to check your spam folder.
              <br />
              Verification links expire after 24 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
