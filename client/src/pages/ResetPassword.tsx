import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AuthShell, AuthStatus, FormError } from '@/components/auth/authUi'
import { CheckIcon, InfoIcon } from '@/components/icons/HockiaIcons'
import { fieldInput, fieldLabel } from '@/components/ui/fieldClasses'
import { PASSWORD_HELP } from '@/lib/onboardingV2'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * ResetPassword - Set new password after clicking email link
 * 
 * This page is reached when user clicks the password reset link from email.
 * Supabase automatically sets the session when the page loads with the recovery token.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
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
        setError('Invalid or expired reset link. Please request a new one.')
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
      setError('The two passwords don’t match.')
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError('Add an uppercase letter, a lowercase letter and a number.')
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
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <AuthShell>
        <div className="flex flex-1 items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-hockia-primary" aria-label="Checking your reset link" />
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
          title="Password updated"
          actions={<Button block onClick={() => navigate('/signin')}>Log in</Button>}
        >
          For your safety you’re signed out on every device. Log in with your new password.
        </AuthStatus>
      </AuthShell>
    )
  }

  if (error && !password) {
    return (
      <AuthShell back={{ parent: 'Log in', onBack: () => navigate('/signin') }}>
        <AuthStatus
          icon={<InfoIcon className="h-9 w-9" />}
          title="This link has expired"
          actions={
            <>
              <Button block onClick={() => navigate('/forgot-password')}>Send a new link</Button>
              <Button block variant="secondary" onClick={() => navigate('/signin')}>Back to log in</Button>
            </>
          }
        >
          Reset links work once and for a limited time. Ask for a new one, it takes a few seconds.
        </AuthStatus>
      </AuthShell>
    )
  }

  return (
    <AuthShell back={{ parent: 'Log in', onBack: () => navigate('/signin') }}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col pt-2">
        <h1 className="text-title text-ink-1">Choose a new password</h1>
        <p className="mt-3 text-[17px] leading-[22px] text-ink-2">Use a password you don’t use anywhere else.</p>
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className={fieldLabel}>New password</label>
            <div className="relative">
              <input id="new-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldInput} pr-12`} autoComplete="new-password" aria-describedby="new-password-help" required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-3">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p id="new-password-help" className="mt-1.5 text-caption text-ink-3">{PASSWORD_HELP}</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className={fieldLabel}>Confirm password</label>
            <div className="relative">
              <input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={`${fieldInput} pr-12`} autoComplete="new-password" required />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-3">
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {error && password && <FormError>{error}</FormError>}
        </div>
        <div className="mt-auto pt-8">
          <Button type="submit" block loading={loading} disabled={!password || !confirmPassword}>Update password</Button>
        </div>
      </form>
    </AuthShell>
  )
}
