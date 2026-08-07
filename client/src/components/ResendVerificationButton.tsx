import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { resendVerificationEmail } from '@/lib/auth'

interface ResendVerificationButtonProps {
  email?: string
}

// Supabase Auth allows one resend per minute. The button used to re-enable
// after a 5s "sent!" flash, so a second click at ~6s hit the rate limit and
// surfaced the raw "For security purposes, you can only request this after
// NN seconds" error (recurring Sentry noise on /verify-email). The button
// now holds a full 60s countdown after a successful send, and if the limit
// is somehow still hit, the error is converted into the same countdown
// instead of being shown raw.
const RESEND_COOLDOWN_S = 60

export default function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCooldown = (seconds: number) => {
    setCooldown(seconds)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const handleResend = async () => {
    if (!email) {
      setError('Email address not provided')
      return
    }

    setIsLoading(true)
    setError(null)

    const result = await resendVerificationEmail(email)

    setIsLoading(false)

    if (result.success) {
      setSent(true)
      startCooldown(RESEND_COOLDOWN_S)
    } else {
      // Rate-limited anyway (e.g. a resend from another tab): show the
      // countdown, not the raw auth error.
      const match = /after (\d+) seconds/.exec(result.error || '')
      if (match) {
        setSent(true)
        startCooldown(parseInt(match[1], 10))
      } else {
        setError(result.error || 'Failed to resend email')
      }
    }
  }

  const disabled = isLoading || cooldown > 0

  return (
    <div className="space-y-3">
      <button
        onClick={handleResend}
        disabled={disabled}
        className={`w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
          cooldown > 0
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
        ) : cooldown > 0 ? (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Resend available in {cooldown}s
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

      {sent && cooldown > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-700">
            Check your inbox for a new verification link.
          </p>
        </div>
      )}
    </div>
  )
}
