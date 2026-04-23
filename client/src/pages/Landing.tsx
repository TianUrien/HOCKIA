import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { Button, InAppBrowserWarning, PublicNav } from '@/components'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * Landing — hero-only surface.
 *
 * Intentionally single-job: showcase the brand and route new users to
 * /signup or returning users to /signin. Auth logic lives in AuthScreen
 * (mode="signin" on /signin, mode="signup" after SignUp role-pick).
 *
 * Pattern rationale (2026 research memo): consumer apps like Duolingo,
 * Robinhood, Revolut, Headspace split hero and auth across surfaces so
 * the hero can breathe and the auth screen can be calm. Productivity
 * tools (Linear, Stripe, Notion) combine — but HOCKIA is consumer.
 */

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

  // Preserve any pre-login redirect intent (e.g. "Apply to Opportunity X"
  // → bounced here by ProtectedRoute) so the post-auth redirect honours it.
  const redirectTo =
    (location.state as { from?: string } | null)?.from ??
    (() => {
      try {
        return sessionStorage.getItem('hockia-redirect-after-login')
      } catch {
        return null
      }
    })()

  const [activeSlide, setActiveSlide] = useState(0)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const autoAdvanceTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedByUser = useRef(false)

  // ── Carousel ──
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

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX.current
      const deltaY = e.changedTouches[0].clientY - touchStartY.current
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return
      pauseAutoAdvance()
      if (deltaX < 0) goNext()
      else goPrev()
    },
    [goNext, goPrev, pauseAutoAdvance]
  )

  // Prevent white flash on iOS overscroll / rubber-band bounce.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#000'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

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

  // ── Redirect already-authenticated users out ──
  useEffect(() => {
    logger.debug('[LANDING] Auth state check', {
      hasUser: !!user,
      hasProfile: !!profile,
      profileStatus,
      authLoading,
    })

    if (authLoading) return

    if (user && profile) {
      const destination = redirectTo || '/dashboard/profile'
      try {
        sessionStorage.removeItem('hockia-redirect-after-login')
      } catch {
        /* noop */
      }
      navigate(destination)
    } else if (
      user &&
      !profile &&
      (profileStatus === 'missing' || profileStatus === 'error' || profileStatus === 'loaded')
    ) {
      navigate('/complete-profile')
    }
  }, [user, profile, profileStatus, authLoading, navigate, redirectTo])

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex flex-col bg-black">
      <InAppBrowserWarning context="login" />

      {/* ── Background image + overlay ── */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="lg:hidden h-full w-full bg-[url('/hero_mobile_2.webp')] bg-cover bg-center" />
        <div className="hidden lg:block h-full w-full bg-[url('/hero-desktop.webp')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/30 via-50% to-black/85" />
      </div>

      {/* ───────────────── MOBILE (<lg) ───────────────── */}
      <div className="lg:hidden absolute inset-0 z-10 flex flex-col pt-6">
        <PublicNav transparent />

        <div
          className="flex-1 flex flex-col justify-between px-6 pt-4 pb-8"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Top spacer — the second HOCKIA logo was removed from mobile
              because it duplicated the PublicNav wordmark right above it.
              Desktop keeps its hero logo (different visual weight, serves
              as the primary brand anchor on wide viewports). */}
          <div aria-hidden="true" />

          {/* Middle: headline carousel */}
          <div className="flex flex-col items-center text-center">
            <div className="relative min-h-[140px] flex items-center justify-center">
              <div key={activeSlide} className="animate-fadeSlideIn">
                <h1 className="text-center text-[2rem] xs:text-[2.25rem] font-bold text-white leading-tight tracking-tight whitespace-pre-line">
                  {CAROUSEL_SLIDES[activeSlide].title}
                </h1>
                <p className="text-center text-white/80 text-base mt-3 whitespace-pre-line">
                  {CAROUSEL_SLIDES[activeSlide].subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  pauseAutoAdvance()
                  goPrev()
                }}
                className="p-1.5 text-white/50 hover:text-white transition-colors"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2">
                {CAROUSEL_SLIDES.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      pauseAutoAdvance()
                      goToSlide(index)
                    }}
                    className={`transition-all duration-300 rounded-full ${
                      index === activeSlide ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-white/40'
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  pauseAutoAdvance()
                  goNext()
                }}
                className="p-1.5 text-white/50 hover:text-white transition-colors"
                aria-label="Next slide"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Bottom: CTAs */}
          <div className="flex flex-col items-stretch gap-3 pb-[env(safe-area-inset-bottom)]">
            <Button
              type="button"
              variant="primary"
              className="w-full !h-14 !rounded-2xl text-base font-semibold shadow-xl"
              onClick={() => navigate('/signup')}
            >
              <span className="inline-flex items-center gap-2">
                Get Started
                <ArrowRight className="w-4 h-4" />
              </span>
            </Button>

            <p className="text-center text-sm text-white/70">
              Already have an account?{' '}
              <Link
                to="/signin"
                className="text-white font-semibold hover:text-white/90 underline-offset-2 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* ───────────────── DESKTOP (≥lg) ───────────────── */}
      <div className="hidden lg:flex relative z-10 flex-1 flex-col">
        <PublicNav transparent />

        <div className="flex-1 flex items-center px-8 xl:px-16">
          <div className="flex-1 pr-12 xl:pr-24 max-w-3xl">
            <img
              src="/WhiteLogo.svg"
              alt="HOCKIA"
              className="h-24 xl:h-32 mb-8 object-contain"
              fetchPriority="high"
              loading="eager"
            />
            <h1 className="text-5xl xl:text-6xl font-bold text-white leading-tight tracking-tight">
              Built for Field Hockey.
            </h1>
            <p className="text-xl lg:text-2xl text-gray-200 mt-6 mb-2">
              Connect players, coaches, and clubs.
            </p>
            <p className="text-xl lg:text-2xl text-gray-200 mb-10">Raise the sport together.</p>

            <div className="flex flex-wrap items-center gap-5">
              <Button
                type="button"
                variant="primary"
                className="!h-14 !rounded-2xl text-base font-semibold px-8 shadow-xl"
                onClick={() => navigate('/signup')}
              >
                <span className="inline-flex items-center gap-2">
                  Get Started
                  <ArrowRight className="w-4 h-4" />
                </span>
              </Button>

              <p className="text-base text-white/80">
                Already have an account?{' '}
                <Link
                  to="/signin"
                  className="text-white font-semibold hover:text-white/90 underline-offset-2 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
