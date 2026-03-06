import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, CheckCircle } from 'lucide-react'
import { Input, Button } from '@/components'
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
      setError('Passwords do not match')
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError('Password must include uppercase, lowercase, and a number')
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

      // Redirect to login after a short delay (user must re-authenticate)
      setTimeout(() => {
        navigate('/')
      }, 2000)
    } catch (err) {
      logger.error('[RESET_PASSWORD] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 text-sm">Verifying reset link...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      {/* Background */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="h-full w-full bg-[url('/hero-desktop.webp')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-black/70" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl p-6 sm:p-8 bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl">
          {success ? (
            /* Success State */
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Password updated!</h3>
              <p className="text-gray-400 mb-6">
                Your password has been successfully reset. All sessions have been signed out for security. Redirecting you to sign in...
              </p>
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            </div>
          ) : error && !password ? (
            /* Error State - Invalid/Expired Link */
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Link expired</h3>
              <p className="text-gray-400 mb-6">{error}</p>
              <Button
                variant="primary"
                onClick={() => navigate('/forgot-password')}
                className="w-full bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
              >
                Request new link
              </Button>
            </div>
          ) : (
            /* Form State */
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-[#8026FA]/20 flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-8 h-8 text-[#924CEC]" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Set new password</h3>
                <p className="text-gray-400">
                  Enter your new password below.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">New Password</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="!bg-white/90"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Confirm Password</label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="!bg-white/90"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {error && password && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full min-h-[44px] bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90"
                  disabled={loading}
                >
                  {loading ? 'Updating...' : 'Reset Password'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
