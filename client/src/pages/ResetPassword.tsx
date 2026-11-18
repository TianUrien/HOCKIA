import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AuthShell, AuthStatus, FormError } from '@/components/auth/authUi'
import { CheckIcon, InfoIcon } from '@/components/icons/HockiaIcons'
import { fieldInput, fieldLabel } from '@/components/ui/fieldClasses'
import { passwordHelp } from '@/lib/onboardingV2'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { tAuth, useAuthT } from '@/i18n/ns/auth'

/**
 * ResetPassword - Set new password after clicking email link
 * 
 * This page is reached when user clicks the password reset link from email.
 * Supabase automatically sets the session when the page loads with the recovery token.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const t = useAuthT()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Check if user has a valid recovery session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        // No session - might be an invalid or expired link
        setError(tAuth('reset.invalidLink'))
      }
      setChecking(false)
    }

    checkSession()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate passwords match
    if (password !== confirmPassword) {
      setError(t('reset.mismatch'))
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError(t('reset.tooShort'))
      return
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError(t('reset.weak'))
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      })

      if (updateError) {
        throw updateError
      }

      // Security: Sign out ALL sessions globally after password reset
      // This ensures any potentially compromised sessions are invalidated
      await supabase.auth.signOut({ scope: 'global' })

      setSuccess(true)
    } catch (err) {
      logger.error('[RESET_PASSWORD] Error:', err)
      setError(err instanceof Error ? err.message : t('reset.failed'))
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <AuthShell>
        <div className="flex flex-1 items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-hockia-primary" aria-label={t('reset.checking')} />
        </div>
      </AuthShell>
    )
  }

  // Rebrand page 26 · recovery: Choose a new password → Password updated, or
  // This link has expired. After a reset every session is signed out (security),
  // so "updated" sends the member to Log in rather than claiming they're signed in.
  if (success) {
    return (
      <AuthShell>
        <AuthStatus
          tone="positive"
          icon={<CheckIcon className="h-9 w-9" />}
          title={t('reset.doneTitle')}
          actions={<Button block onClick={() => navigate('/signin')}>{t('reset.doneAction')}</Button>}
        >
          {t('reset.doneBody')}
        </AuthStatus>
      </AuthShell>
    )
  }

  if (error && !password) {
    return (
      <AuthShell back={{ parent: t('shell.parentLogIn'), onBack: () => navigate('/signin') }}>
        <AuthStatus
          icon={<InfoIcon className="h-9 w-9" />}
          title={t('reset.expiredTitle')}
          actions={
            <>
              <Button block onClick={() => navigate('/forgot-password')}>{t('reset.sendNew')}</Button>
              <Button block variant="secondary" onClick={() => navigate('/signin')}>{t('reset.backToLogIn')}</Button>
            </>
          }
        >
          {t('reset.expiredBody')}
        </AuthStatus>
      </AuthShell>
    )
  }

  return (
    <AuthShell back={{ parent: t('shell.parentLogIn'), onBack: () => navigate('/signin') }}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col pt-2">
        <h1 className="text-title text-ink-1">{t('reset.title')}</h1>
        <p className="mt-3 text-[17px] leading-[22px] text-ink-2">{t('reset.subtitle')}</p>
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className={fieldLabel}>{t('reset.newPassword')}</label>
            <div className="relative">
              <input id="new-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldInput} pr-12`} autoComplete="new-password" aria-describedby="new-password-help" required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('fields.hidePassword') : t('fields.showPassword')} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-3">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p id="new-password-help" className="mt-1.5 text-caption text-ink-3">{passwordHelp()}</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className={fieldLabel}>{t('reset.confirmPassword')}</label>
            <div className="relative">
              <input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={`${fieldInput} pr-12`} autoComplete="new-password" required />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? t('fields.hidePassword') : t('fields.showPassword')} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-3">
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {error && password && <FormError>{error}</FormError>}
        </div>
        <div className="mt-auto pt-8">
          <Button type="submit" block loading={loading} disabled={!password || !confirmPassword}>{t('reset.submit')}</Button>
        </div>
      </form>
    </AuthShell>
  )
}
