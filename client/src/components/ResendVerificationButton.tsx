import { buttonClassName } from '@/components/ui/buttonClasses'
import { useEffect, useRef, useState } from 'react'
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
      {/* Rebrand page 26 · Check your inbox: one violet action; the cooldown
          reads as a calm countdown, never a green "success" button. */}
      <button
        type="button"
        onClick={handleResend}
        disabled={disabled}
        className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}
      >
        {isLoading ? (
          <>
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            Sending…
          </>
        ) : (
          'Resend email'
        )}
      </button>
      {cooldown > 0 && (
        <p className="text-center text-caption text-ink-3" aria-live="polite">
          Didn’t get it? You can resend in {Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, '0')}.
        </p>
      )}

      {error && (
        <div className="bg-status-danger-soft rounded-[12px] px-3.5 py-2.5">
          <p className="text-sm text-status-danger">{error}</p>
        </div>
      )}

      {sent && cooldown > 0 && (
        <div className="bg-positive-soft rounded-[12px] px-3.5 py-2.5">
          <p className="text-sm text-positive">
            Check your inbox for a new verification link.
          </p>
        </div>
      )}
    </div>
  )
}
