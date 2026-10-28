import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { fieldInput, fieldLabel } from '@/components/ui/fieldClasses'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { getSiteUrl } from '@/lib/siteUrl'
import { checkPasswordResetRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { captchaErrorMessage, getCaptchaToken, reportCaptchaCoverage, warmCaptcha } from '@/lib/captcha'

/**
 * ForgotPassword - Request password reset email
 * 
 * Flow:
 * 1. User enters their email
 * 2. Supabase sends password reset email
 * 3. User clicks link in email → /auth/callback with recovery token
 * 4. AuthCallback detects recovery and redirects to /reset-password
 */
export default function ForgotPassword() {
  const navigate = useNavigate()
  // Get the bot check ready while the member types (lib/captcha).
  useEffect(() => { warmCaptcha('reset') }, [])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Check rate limit before sending password reset email
      const rateLimit = await checkPasswordResetRateLimit(email)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        setLoading(false)
        return
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteUrl()}/reset-password`,
        captchaToken: await getCaptchaToken('reset'),
      })

      if (resetError) {
        const captcha = captchaErrorMessage(resetError.message)
        throw captcha ? new Error(captcha) : resetError
      }
      reportCaptchaCoverage('reset')

      setSuccess(true)
    } catch (err) {
      logger.error('[FORGOT_PASSWORD] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  // Rebrand page 26 · Forgot password: the white auth page, one field, one action.
  return (
    <AuthShell back={{ parent: 'Log in', onBack: () => navigate('/signin') }}>
      {success ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-hockia-soft text-hockia-primary">
            <Mail className="h-9 w-9" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h1 className="mt-8 text-title text-ink-1">Check your inbox</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            We sent a reset link to <span className="font-semibold text-ink-1">{email}</span>. It works once, for a limited time.
          </p>
          <div className="mt-auto w-full space-y-3 pt-8">
            <Button block variant="secondary" onClick={() => setSuccess(false)}>Use a different email</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col pt-2">
          <h1 className="text-title text-ink-1">Reset your password</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">Enter the email you joined with and we’ll send you a link to choose a new one.</p>
          <div className="mt-6">
            <label htmlFor="reset-email" className={fieldLabel}>Email</label>
            <input
              id="reset-email"
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
          {error && <div className="mt-4"><FormError>{error}</FormError></div>}
          <div className="mt-auto pt-8">
            <Button type="submit" block loading={loading} disabled={!email.trim()}>Send reset link</Button>
          </div>
        </form>
      )}
    </AuthShell>
  )
}
