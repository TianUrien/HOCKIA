import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock, User, Building2, Briefcase, Store } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { Input, Button, InAppBrowserWarning } from '@/components'
import { supabase } from '@/lib/supabase'
import { getAuthRedirectUrl } from '@/lib/siteUrl'
import { logger } from '@/lib/logger'
import { supportsReliableOAuth } from '@/lib/inAppBrowser'
import { checkSignupRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { trackSignUpStart, trackSignUp } from '@/lib/analytics'

type UserRole = 'player' | 'coach' | 'club' | 'brand'
type SignUpResponse = Awaited<ReturnType<typeof supabase.auth.signUp>>

/**
 * SignUp - Step 1 of signup (PRE email verification)
 * 
 * Flow:
 * 1. User selects role
 * 2. User enters email + password
 * 3. Create auth account with role in metadata
 * 4. Store role in localStorage (fallback)
 * 5. Redirect to /verify-email to check inbox
 * 
 * NO profile data collection yet - that happens AFTER verification
 */
export default function SignUp() {
  const navigate = useNavigate()
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!selectedRole) {
        throw new Error('Please select a role')
      }

      if (formData.password.length < 8) {
        throw new Error('Password must be at least 8 characters long')
      }
      if (!/[a-z]/.test(formData.password) || !/[A-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
        throw new Error('Password must include uppercase, lowercase, and a number')
      }

      // Check rate limit before attempting signup
      const rateLimit = await checkSignupRateLimit(formData.email)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        setLoading(false)
        return
      }

      logger.debug('Creating auth account with role:', selectedRole)
      trackSignUpStart('email')

      // Create auth account (no session until email verified)
      const { data: authData, error: signUpError }: SignUpResponse = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            role: selectedRole, // Store in user_metadata
          }
        }
      })
      const authUser = (authData as { user?: { id?: string | null } | null } | null)?.user ?? null

      if (signUpError) {
        Sentry.captureException(signUpError, {
          tags: { feature: 'auth_flow' },
          extra: {
            userId: authUser?.id ?? null,
            payload: {
              role: selectedRole,
              emailDomain: formData.email.split('@')[1] ?? null,
            },
            sourceComponent: 'SignUp.handleSubmit.supabaseSignUp',
          },
        })
        // Handle "user already exists" error with helpful message
        if (signUpError.message.includes('already registered') || 
            signUpError.message.includes('already exists') ||
            signUpError.message.includes('User already registered')) {
          logger.debug('User already registered, showing helpful error')
          setError('This email is already registered. Please sign in instead.')
          setTimeout(() => {
            navigate('/')
          }, 3000)
          return
        }
        throw signUpError
      }

      if (!authUser) throw new Error('No user data returned from signup')

      logger.debug('Auth account created successfully:', authUser.id)
      trackSignUp(selectedRole)

      // Store role in localStorage as fallback
      localStorage.setItem('pending_role', selectedRole)
      localStorage.setItem('pending_email', formData.email)

      logger.debug('Redirecting to /verify-email')

      // Redirect to verify email page (email already in localStorage, not in URL to avoid browser history leak)
      navigate('/verify-email')

    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: 'auth_flow' },
        extra: {
          userId: null,
          payload: {
            role: selectedRole,
            emailDomain: formData.email.split('@')[1] ?? null,
          },
          sourceComponent: 'SignUp.handleSubmit.catch',
        },
      })
      logger.error('Sign up error:', err)
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col">
      {/* In-App Browser Warning */}
      <InAppBrowserWarning context="signup" />
      
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="absolute inset-0" aria-hidden="true">
          <div className="h-full w-full bg-[url('/hero-desktop.webp')] bg-cover bg-center" />
          <div className="absolute inset-0 bg-black/70" />
        </div>

        <div className="relative z-10 w-full max-w-2xl">
          <div className="bg-white rounded-2xl shadow-2xl animate-scale-in overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-[#8026FA] to-[#924CEC]">
              <div className="flex items-center gap-3 mb-2">
                <img
                  src="/WhiteLogo.svg"
                  alt="PLAYR"
                  className="h-8"
                />
              </div>
              <p className="text-white/90 text-sm">
                Create your account and start your field hockey journey
              </p>
            </div>

          {/* Role Selection */}
          {!selectedRole && (
            <div className="p-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2 text-center">Join PLAYR</h3>
              <p className="text-gray-600 mb-8 text-center">Select your role to get started</p>

              <div className="space-y-4">
                <button
                  onClick={() => setSelectedRole('player')}
                  className="w-full flex items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-[#8026FA]/5 transition-all group"
                >
                  <div className="w-14 h-14 rounded-full bg-[#8026FA]/10 group-hover:bg-[#8026FA] flex items-center justify-center transition-colors">
                    <User className="w-7 h-7 text-[#8026FA] group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-lg font-bold text-gray-900 mb-1">Join as Player</h4>
                    <p className="text-sm text-gray-600">Showcase your skills and connect with clubs</p>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedRole('coach')}
                  className="w-full flex items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-[#924CEC] hover:bg-[#924CEC]/5 transition-all group"
                >
                  <div className="w-14 h-14 rounded-full bg-[#924CEC]/10 group-hover:bg-[#924CEC] flex items-center justify-center transition-colors">
                    <Briefcase className="w-7 h-7 text-[#924CEC] group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-lg font-bold text-gray-900 mb-1">Join as Coach</h4>
                    <p className="text-sm text-gray-600">Find opportunities and mentor players</p>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedRole('club')}
                  className="w-full flex items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-[#ec4899] hover:bg-[#ec4899]/5 transition-all group"
                >
                  <div className="w-14 h-14 rounded-full bg-[#ec4899]/10 group-hover:bg-[#ec4899] flex items-center justify-center transition-colors">
                    <Building2 className="w-7 h-7 text-[#ec4899] group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-lg font-bold text-gray-900 mb-1">Join as Club</h4>
                    <p className="text-sm text-gray-600">Discover talent and build your team</p>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedRole('brand')}
                  className="w-full flex items-center gap-4 p-6 border-2 border-gray-200 rounded-xl hover:border-[#f59e0b] hover:bg-[#f59e0b]/5 transition-all group"
                >
                  <div className="w-14 h-14 rounded-full bg-[#f59e0b]/10 group-hover:bg-[#f59e0b] flex items-center justify-center transition-colors">
                    <Store className="w-7 h-7 text-[#f59e0b] group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-lg font-bold text-gray-900 mb-1">Join as Brand</h4>
                    <p className="text-sm text-gray-600">Showcase products and connect with athletes</p>
                  </div>
                </button>
              </div>

              <div className="mt-6 text-center">
                <button
                  onClick={() => navigate('/')}
                  className="text-sm text-[#8026FA] hover:text-[#6B20D4] font-medium"
                >
                  Already have an account? Sign in
                </button>
              </div>

              {/* Google Sign-In Divider */}
              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white text-gray-500">or</span>
                  </div>
                </div>

                {/* Google Sign-In Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (!supportsReliableOAuth()) {
                      // Show warning - OAuth may not work in in-app browsers
                      alert('Google Sign-In may not work in this browser. Please use email/password signup, or open PLAYR in Safari or Chrome.')
                      return
                    }
                    trackSignUpStart('google')
                    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: getAuthRedirectUrl() } })
                  }}
                  className="mt-4 w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span className="text-gray-700 font-medium">Continue with Google</span>
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  You'll choose your role after signing in
                </p>
              </div>
            </div>
          )}

          {/* Email + Password Form */}
          {selectedRole && (
            <form onSubmit={handleSubmit} className="p-8">
              <button
                type="button"
                onClick={() => setSelectedRole(null)}
                className="mb-6 text-sm text-[#8026FA] hover:text-[#6B20D4] font-medium"
              >
                ← Back to role selection
              </button>

              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {selectedRole === 'player' && 'Join as Player'}
                {selectedRole === 'coach' && 'Join as Coach'}
                {selectedRole === 'club' && 'Join as Club'}
                {selectedRole === 'brand' && 'Join as Brand'}
              </h3>
              <p className="text-gray-600 mb-6">
                Enter your email and password to create your account
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <Input
                  label="Email"
                  type="email"
                  icon={<Mail className="w-5 h-5" />}
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Min. 8 chars, uppercase, lowercase & number"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters long</p>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full mt-6 bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </Button>

              <p className="text-xs text-gray-500 mt-4 text-center">
                By signing up, you agree to our Terms of Service and Privacy Policy
              </p>
            </form>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
