import { useState } from 'react'
import { Mail } from 'lucide-react'
import { resendVerificationEmail } from '@/lib/auth'

interface ResendVerificationButtonProps {
  email?: string
}

export default function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResend = async () => {
    if (!email) {
      setError('Email address not provided')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(false)

    const result = await resendVerificationEmail(email)

    setIsLoading(false)

    if (result.success) {
      setSuccess(true)
      // Reset success message after 5 seconds
      setTimeout(() => setSuccess(false), 5000)
    } else {
      setError(result.error || 'Failed to resend email')
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleResend}
        disabled={isLoading || success}
        className={`w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
          success
            ? 'bg-green-100 text-green-700 cursor-not-allowed'
            : isLoading
            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white hover:opacity-90'
        }`}
      >
        {isLoading ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            Sending...
          </>
        ) : success ? (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Verification Email Sent!
          </>
        ) : (
          <>
            <Mail className="w-5 h-5" />
            Resend Verification Email
          </>
        )}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-700">
            Check your inbox for a new verification link.
          </p>
        </div>
      )}
    </div>
  )
}
