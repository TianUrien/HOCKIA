import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input, Button, InAppBrowserWarning, PublicNav } from '@/components'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { startOAuthSignIn } from '@/lib/oauthSignIn'
import { supportsReliableOAuth } from '@/lib/inAppBrowser'
import { checkLoginRateLimit, formatRateLimitError } from '@/lib/rateLimit'

const CAROUSEL_SLIDES = [
  {
    title: 'Built for\nField Hockey.',
    subtitle: 'The home of players, coaches, clubs\nand brands.',
  },
  {
    title: 'For Players\n& Coaches.',
    subtitle: 'Connect with your community.\nTrack your journey. Elevate your game.',
  },
  {
    title: 'For Clubs\n& Brands.',
    subtitle: 'Build your presence. Engage your fans.\nGrow the sport.',
  },
] as const

const AUTO_ADVANCE_MS = 5000
const RESUME_DELAY_MS = 8000
const SWIPE_THRESHOLD = 50

export default function Landing() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, profileStatus, loading: authLoading } = useAuthStore()
  
  // Check if user was redirected from a protected route (e.g., /settings from email link)
  const redirectTo = (location.state as { from?: string } | null)?.from
    ?? (() => { try { return sessionStorage.getItem('hockia-redirect-after-login') } catch { return null } })()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeSlide, setActiveSlide] = useState(0)
  const [showPassword, setShowPassword] = useState(false)

  // Carousel refs
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const autoAdvanceTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedByUser = useRef(false)

  const captureAuthFlowError = (
    err: unknown,
    payload: Record<string, unknown>,
    sourceComponent: string,
    explicitUserId?: string | null
  ) => {
    Sentry.captureException(err, {
      tags: { feature: 'auth_flow' },
      extra: {
        userId: explicitUserId ?? user?.id ?? null,
        payload,
        sourceComponent,
      },
    })
  }

  // Carousel navigation
  const goToSlide = useCallback((index: number) => {
    setActiveSlide(index)
  }, [])

  const goNext = useCallback(() => {
    setActiveSlide((prev) => (prev + 1) % CAROUSEL_SLIDES.length)
  }, [])

  const goPrev = useCallback(() => {
    setActiveSlide((prev) => (prev - 1 + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length)
  }, [])

  const pauseAutoAdvance = useCallback(() => {
    isPausedByUser.current = true
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => {
      isPausedByUser.current = false
    }, RESUME_DELAY_MS)
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current

    // Only register horizontal swipes (ignore vertical scroll)
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return

    pauseAutoAdvance()
    if (deltaX < 0) goNext()
    else goPrev()
  }, [goNext, goPrev, pauseAutoAdvance])

  // Force dark body background while landing page is mounted (prevents
  // white flash on iOS overscroll / rubber-band bounce)
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#000'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  // Auto-advance carousel
  useEffect(() => {
    autoAdvanceTimer.current = setInterval(() => {
      if (!isPausedByUser.current) {
        setActiveSlide((prev) => (prev + 1) % CAROUSEL_SLIDES.length)
      }
    }, AUTO_ADVANCE_MS)

    return () => {
      if (autoAdvanceTimer.current) clearInterval(autoAdvanceTimer.current)
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [])

  // Redirect if already logged in
  useEffect(() => {
    logger.debug('[LANDING] Auth state check', { 
      hasUser: !!user, 
      hasProfile: !!profile, 
      profileStatus,
      authLoading
    })
    
    // Wait for auth to finish loading
    if (authLoading) return
    
    if (user && profile) {
      const destination = redirectTo || '/dashboard/profile'
      logger.debug('[LANDING] User has profile, redirecting to', destination)
      try { sessionStorage.removeItem('hockia-redirect-after-login') } catch { /* noop */ }
      navigate(destination)
    } else if (user && !profile && (profileStatus === 'missing' || profileStatus === 'error' || profileStatus === 'loaded')) {
      // User authenticated but no profile (e.g., new Google OAuth user)
      // Redirect to complete profile / onboarding
      logger.debug('[LANDING] User authenticated, no profile, redirecting to complete-profile', { profileStatus })
      navigate('/complete-profile')
    }
  }, [user, profile, profileStatus, authLoading, navigate, redirectTo])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Client-side validation
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Email is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!password) {
      setError('Password is required.')
      return
    }

    setLoading(true)

    try {
      // Check rate limit before attempting login
      const rateLimit = await checkLoginRateLimit(email)
      if (rateLimit && !rateLimit.allowed) {
        setError(formatRateLimitError(rateLimit))
        setLoading(false)
        return
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (signInError) {
        captureAuthFlowError(signInError, {
          stage: 'signInWithPassword',
          emailDomain: email.split('@')[1] ?? null,
        }, 'Landing.handleSignIn.supabaseSignIn', null)
        // Check if error is due to unverified email
        if (signInError.message.includes('Email not confirmed')) {
          // Redirect to verification page
          logger.debug('[SIGN IN] Email not verified, redirecting to verification page')
          navigate(`/verify-email?email=${encodeURIComponent(email)}&reason=unverified_signin`)
          return
        }
        throw signInError
      }

      if (!data.user) {
        throw new Error('No user data returned')
      }

      logger.debug('[SIGN IN] Sign in successful, checking profile...')

      // Check if profile exists and is complete
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('id', data.user.id)
        .single()

      // Handle profile not found - redirect to complete profile
      if (profileError && profileError.code === 'PGRST116') {
        logger.debug('[SIGN IN] Profile not found, redirecting to complete profile')
        navigate('/complete-profile')
        return
      }

      // Other profile errors - don't sign out, let user retry
      if (profileError) {
        captureAuthFlowError(profileError, {
          stage: 'profileFetch',
          emailDomain: email.split('@')[1] ?? null,
        }, 'Landing.handleSignIn.profileFetch', data.user.id)
        logger.error('[SIGN IN] Error fetching profile:', profileError)
        setError('Could not load your profile. Please try again or contact support if this persists.')
        setLoading(false)
        return
      }

      if (!profileData) {
        logger.error('[SIGN IN] Profile is null (unexpected)')
        setError('Profile not found. Please contact support.')
        setLoading(false)
        return
      }

      // Check if profile is incomplete (zombie account recovery!)
      if (!profileData.full_name) {
        logger.debug('[SIGN IN] Profile incomplete (no full_name), redirecting to complete profile')
        navigate('/complete-profile')
        return
      }

      // Profile is complete - redirect to intended destination or dashboard
      const destination = redirectTo || '/dashboard/profile'
      logger.debug('[SIGN IN] Profile complete, redirecting to:', destination)
      try { sessionStorage.removeItem('hockia-redirect-after-login') } catch { /* noop */ }
      navigate(destination)

    } catch (err) {
      captureAuthFlowError(err, {
        stage: 'Landing.handleSignIn.catch',
        emailDomain: email.split('@')[1] ?? null,
      }, 'Landing.handleSignIn.catch', null)
      logger.error('[SIGN IN] Sign in error:', err)
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex flex-col bg-black">
      {/* In-App Browser Warning */}
      <InAppBrowserWarning context="login" />
      
      {/* Background Image with Overlay - Responsive Art Direction */}
      <div className="absolute inset-0" aria-hidden="true">
        {/* Mobile: Portrait-optimized image */}
        <div className="lg:hidden h-full w-full bg-[url('/hero_mobile_2.webp')] bg-cover bg-center" />
        {/* Desktop: Landscape-optimized image */}
        <div className="hidden lg:block h-full w-full bg-[url('/hero-desktop.webp')] bg-cover bg-center" />
        {/* Multi-stop gradient: dark top for logo, clear middle for hero visibility, dark bottom for form */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/25 via-50% to-black/75" />
      </div>

      {/* ===== MOBILE LAYOUT (< lg) ===== */}
      <div className="lg:hidden absolute inset-0 z-10 flex flex-col pt-6 overflow-y-auto">
        <PublicNav transparent />

        {/* Hero Zone - Swipeable Carousel */}
        <div
          className="flex-none flex flex-col justify-start px-6 pt-8 pb-2"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Slide content with fade transition */}
          <div className="relative min-h-[120px] flex items-center justify-center">
            <div key={activeSlide} className="animate-fadeSlideIn">
              <h1 className="text-center text-[1.85rem] xs:text-[2.05rem] font-bold text-white leading-tight tracking-tight whitespace-pre-line">
                {CAROUSEL_SLIDES[activeSlide].title}
              </h1>
              <p className="text-center text-white/80 text-sm mt-2 whitespace-pre-line">
                {CAROUSEL_SLIDES[activeSlide].subtitle}
              </p>
            </div>
          </div>

          {/* Carousel Controls: arrows + dots + hint */}
          <div className="flex flex-col items-center mt-4 gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { pauseAutoAdvance(); goPrev() }}
                className="p-1.5 text-white/60 hover:text-white transition-colors"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2">
                {CAROUSEL_SLIDES.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => { pauseAutoAdvance(); goToSlide(index) }}
                    className={`transition-all duration-300 rounded-full ${
                      index === activeSlide
                        ? 'w-6 h-2 bg-white'
                        : 'w-2 h-2 bg-white/40'
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => { pauseAutoAdvance(); goNext() }}
                className="p-1.5 text-white/60 hover:text-white transition-colors"
                aria-label="Next slide"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <p className="text-white/40 text-[10px] tracking-wider">
              Swipe to explore
            </p>
          </div>
        </div>

        {/* Sign In Card */}
        <div className="flex-shrink-0 px-6 pb-[env(safe-area-inset-bottom)] mt-4">
          <div 
            data-signin-card
            className="rounded-2xl px-5 py-5 bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl"
          >
            <h2 className="text-lg font-bold text-white text-center mb-3">Sign In</h2>
            
            <form onSubmit={handleSignIn} noValidate className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="!bg-white border-0 text-gray-900 placeholder:text-gray-400 !h-10 text-[13px] !rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="!bg-white border-0 text-gray-900 placeholder:text-gray-400 !h-10 text-[13px] !rounded-xl !pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-xs">{error}</p>
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full !h-10 !rounded-xl text-[13px] font-semibold"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="text-[11px] text-gray-400 hover:text-white transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </form>

            <div className="relative my-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/15"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] text-gray-500 bg-black/50 font-semibold">OR</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!supportsReliableOAuth()) {
                  alert('Google Sign-In may not work in this browser. Please use email/password login, or open HOCKIA in Safari or Chrome.')
                  return
                }
                startOAuthSignIn('google').catch(err => { logger.error('Google OAuth error:', err); setError('Sign-in failed. Please try again.') })
              }}
              className="w-full flex items-center justify-center gap-2 h-10 bg-white rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-gray-700 text-[13px] font-medium">Continue with Google</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!supportsReliableOAuth()) {
                  alert('Apple Sign-In may not work in this browser. Please use email/password login, or open HOCKIA in Safari or Chrome.')
                  return
                }
                startOAuthSignIn('apple').catch(err => { logger.error('Apple OAuth error:', err); setError('Sign-in failed. Please try again.') })
              }}
              className="w-full flex items-center justify-center gap-2 h-10 bg-white rounded-xl hover:bg-gray-100 transition-colors shadow-sm mt-2"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="black">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              <span className="text-black text-[13px] font-medium">Continue with Apple</span>
            </button>

            <p className="mt-3 text-center text-[11px] text-gray-400">
              Don't have an account?{' '}
              <button
                onClick={() => navigate('/signup')}
                className="text-[#924CEC] hover:text-[#a855f7] font-semibold transition-colors"
              >
                Create account
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* ===== DESKTOP LAYOUT (≥ lg) ===== */}
      <div className="hidden lg:flex relative z-10 flex-1 flex-col">
        {/* Public Navigation */}
        <PublicNav transparent />

        {/* Desktop Content */}
        <div className="flex-1 flex items-center px-8 xl:px-16">
          {/* Hero Content */}
          <div className="flex-1 pr-12 xl:pr-24">
            <img 
              src="/WhiteLogo.svg" 
              alt="HOCKIA"
              className="h-24 xl:h-32 mb-6 object-contain"
              fetchPriority="high"
              loading="eager"
            />
            <h1 className="text-5xl xl:text-6xl font-bold text-white leading-tight">
              Built for Field Hockey.
            </h1>
            <p className="text-xl lg:text-2xl text-gray-200 mt-6 mb-4">
              Connect players, coaches, and clubs.
            </p>
            <p className="text-xl lg:text-2xl text-gray-200">
              Raise the sport together.
            </p>
          </div>

          {/* Sign In Card - Desktop */}
          <div className="w-[400px] xl:w-[420px]">
            <div 
              data-signin-card
              className="rounded-2xl p-8 bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl"
            >
              <h2 className="text-2xl font-bold text-white text-center mb-6">Sign In</h2>
              
              <form onSubmit={handleSignIn} noValidate className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="!bg-white border-0 text-gray-900 placeholder:text-gray-400 !h-12 !rounded-xl"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-gray-400">Password</label>
                    <button
                      type="button"
                      onClick={() => navigate('/forgot-password')}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="!bg-white border-0 text-gray-900 placeholder:text-gray-400 !h-12 !rounded-xl"
                    required
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full !h-12 !rounded-xl text-base font-semibold shadow-lg"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/15"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-xs text-gray-500 bg-black/60">or continue with</span>
                </div>
              </div>

              {/* Google Button */}
              <button
                type="button"
                onClick={() => {
                  if (!supportsReliableOAuth()) {
                    alert('Google Sign-In may not work in this browser. Please use email/password login, or open HOCKIA in Safari or Chrome.')
                    return
                  }
                  startOAuthSignIn('google').catch(err => { logger.error('Google OAuth error:', err); setError('Sign-in failed. Please try again.') })
                }}
                className="w-full flex items-center justify-center gap-2.5 h-12 bg-white rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="text-gray-700 font-medium">Continue with Google</span>
              </button>

              {/* Apple Button — white style per Apple HIG (Guideline 4) */}
              <button
                type="button"
                onClick={() => {
                  if (!supportsReliableOAuth()) {
                    alert('Apple Sign-In may not work in this browser. Please use email/password login, or open HOCKIA in Safari or Chrome.')
                    return
                  }
                  startOAuthSignIn('apple').catch(err => { logger.error('Apple OAuth error:', err); setError('Sign-in failed. Please try again.') })
                }}
                className="w-full flex items-center justify-center gap-2.5 h-12 bg-white rounded-xl hover:bg-gray-100 transition-colors shadow-sm mt-3"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="black">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <span className="text-black font-medium">Continue with Apple</span>
              </button>

              {/* Join CTA */}
              <p className="mt-5 text-center text-sm text-gray-400">
                New here?{' '}
                <button
                  onClick={() => navigate('/signup')}
                  className="text-[#924CEC] hover:text-[#a855f7] font-semibold transition-colors"
                >
                  Join HOCKIA
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
