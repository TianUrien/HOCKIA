import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { hasPersistedSession } from '@/lib/persistedSession'
import NativeLaunchSplash from '@/components/NativeLaunchSplash'

/**
 * NativeWelcome — the first screen of the iOS / Android apps.
 *
 * Design: Figma "02-F3 · First run — Single CTA" (node 66:1675), founder-
 * selected 2026-08-17. Someone opening the app from the App Store or Google
 * Play has ALREADY converted on intent — they don't need the website's job
 * (explain, prove, persuade). They need to feel they're in the right place
 * and get in fast: real players, the tagline, one dominant action.
 *
 * This is the NATIVE app's own entry, rendered at "/" only when
 * Capacitor.isNativePlatform() — the website keeps the Web A landing
 * (src/pages/Landing.tsx) untouched. Until now the native app opened on the
 * full marketing scroll with the store badges hidden, which is the wrong
 * screen for someone who has already installed.
 *
 * Composition notes carried from the design review:
 *  - The lockup sits BELOW the point where the photo fade reaches full
 *    opacity, so the brand mark lands on clean white — in the first draft it
 *    sat 34px inside the translucent band, on the muddiest part of the screen.
 *  - No carousel, no skip-through onboarding: users swipe past them.
 *  - Apple/Google OAuth are deliberately NOT here (founder decision). They
 *    live one tap away on the signup screen, Apple-first per HIG.
 *
 * Auth redirect is identical to Landing's, so a returning member with a live
 * session never sees this screen — they go straight to their dashboard (or
 * the pre-login redirect target, open-redirect-guarded).
 */

const INK = '#2b2a33'
const BRAND_TEXT = '#5b21b6'

export default function NativeWelcome() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, profileStatus, loading: authLoading } = useAuthStore()

  const redirectTo =
    (location.state as { from?: string } | null)?.from ??
    (() => {
      try {
        return sessionStorage.getItem('hockia-redirect-after-login')
      } catch {
        return null
      }
    })()

  // ── First-frame selection (founder report, 2026-08-17: launch flicker) ──
  // The auth store boots with loading:true and hydrates the persisted session
  // asynchronously; rendering the welcome during that window flashed
  // "Create account" at signed-in members for <1s before the redirect fired.
  // The persisted-session check is SYNCHRONOUS, so the very first frame is
  // chosen correctly with no timers and no artificial delay:
  //   hydrating + stored session  → splash continuation (violet + mark, the
  //                                 same design as the native launch screen,
  //                                 so the wait is visually invisible)
  //   hydrating + nothing stored  → welcome immediately (fresh installs pay
  //                                 zero delay — hydration cannot produce a
  //                                 user from empty storage)
  //   resolved  + user            → splash while the redirect effect runs
  //   resolved  + no user         → welcome (covers expired/revoked stored
  //                                 sessions: hydration failed, so the
  //                                 unauthenticated flow is the truth)
  // Read once per mount: hydration outcomes flow through the store, and
  // re-reading mid-flight could flap the frame.
  const [storedSession] = useState(() => hasPersistedSession())
  const showWelcome = authLoading ? !storedSession : !user

  useEffect(() => {
    void setStatusBarForBackground(showWelcome ? 'light-bg' : 'dark-bg')
  }, [showWelcome])

  // ── Redirect already-authenticated users out (same contract as Landing) ──
  useEffect(() => {
    if (authLoading) return
    if (user && profile) {
      const destination = safeRedirectPath(redirectTo, '/dashboard/profile')
      try {
        sessionStorage.removeItem('hockia-redirect-after-login')
      } catch {
        /* noop */
      }
      navigate(destination, { replace: true })
    } else if (
      user && !profile &&
      (profileStatus === 'missing' || profileStatus === 'error' || profileStatus === 'loaded')
    ) {
      navigate('/complete-profile', { replace: true })
    }
  }, [user, profile, profileStatus, authLoading, navigate, redirectTo])

  // Funnel event only when the welcome is actually SHOWN — a returning
  // member passing through the splash must not log a welcome page view.
  useEffect(() => {
    if (!showWelcome) return
    trackDbEvent('page_view', undefined, undefined, { path: '/', surface: 'native_welcome' })
  }, [showWelcome])

  if (!showWelcome) {
    // To the user the system splash simply lasts a moment longer, then the
    // dashboard appears. Not a spinner, not the welcome — no unauthenticated
    // UI ever paints for a stored session.
    return <NativeLaunchSplash />
  }

  return (
    <div
      className="relative flex min-h-screen-dvh w-full flex-col overflow-hidden bg-white"
      style={{ color: INK }}
    >
      {/* ── Stage: disc + ring + the two players + fade ──────────────────
          Absolute geometry from the 390×844 frame, expressed in vw/aspect so
          it scales across phone widths without shipping a second layout.
          The stage is a fixed 390-unit coordinate space centred in the
          viewport; the artwork sits at its design positions inside it. */}
      {/* Stage height yields on SHORT phones (iPhone SE class, 667pt) so the
          tagline and both actions always fit: 560px is the design height at
          844pt; on a 667pt screen it drops to ~58vh so the copy + actions
          (~230px) still clear. The art scales uniformly with the stage. */}
      <div
        className="relative w-full shrink-0"
        style={{
          // --stage-h is the ONE number; the inner stage scales from it in
          // pure CSS, so there is no layout read and no ref.
          ['--stage-h' as string]: 'clamp(380px, min(560px, 100dvh - 300px), 560px)',
          height: 'var(--stage-h)',
        }}
      >
        <div
          className="absolute left-1/2 top-0 origin-top"
          style={{
            width: 390,
            height: 560,
            transform: 'translateX(-50%) scale(calc(var(--stage-h) / 560px))',
          }}
          aria-hidden="true"
        >
          {/* Stage disc — soft violet-white radial, y=68, 370×370 */}
          <div
            className="absolute rounded-full"
            style={{
              left: 10, top: 68, width: 370, height: 370,
              background: 'radial-gradient(circle at 50% 40%, #ffffff 0%, #f8f5ff 55%, #f2edff 100%)',
            }}
          />
          {/* Stage ring — hairline violet, y=42, 430×430 */}
          <div
            className="absolute rounded-full"
            style={{
              left: -20, top: 42, width: 430, height: 430,
              border: '1.5px solid rgba(124,58,237,0.16)',
            }}
          />
          {/* Player — man (behind), design box 302×310 at (10,128) */}
          <img
            src="/native/player-man.webp"
            alt=""
            width={604}
            height={620}
            fetchPriority="high"
            decoding="async"
            className="absolute max-w-none select-none object-contain"
            style={{ left: 10, top: 128, width: 302, height: 310 }}
            draggable={false}
          />
          {/* Player — woman (front), design box 584×430 at (-56,66) */}
          <img
            src="/native/player-woman.webp"
            alt=""
            width={1168}
            height={860}
            fetchPriority="high"
            decoding="async"
            className="absolute max-w-none select-none object-contain"
            style={{ left: -56, top: 66, width: 584, height: 430 }}
            draggable={false}
          />
          {/* Fade — transparent → white, resolving fully at y=496 (design:
              y=226 + 75% of 360). The lockup below starts at 512, so the
              brand always lands on solid white. */}
          <div
            className="absolute left-0 w-full"
            style={{
              top: 226, height: 360,
              background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #ffffff 75%)',
            }}
          />
        </div>
      </div>

      {/* ── Copy: lockup + tagline ─────────────────────────────────────── */}
      <div className="relative z-10 -mt-12 flex shrink-0 flex-col items-center gap-3.5 px-6">
        <div className="flex items-center gap-2">
          <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="h-[26px] w-auto" />
          <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" width={153} height={42} className="h-4 w-auto" />
        </div>
        <h1
          className="text-center text-[34px] font-extrabold leading-[37px] tracking-[-0.034em]"
          style={{ color: INK }}
        >
          Your game.
          <span className="block" style={{ color: BRAND_TEXT }}>Your network.</span>
        </h1>
      </div>

      <div className="min-h-[24px] flex-1" />

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex flex-col items-center gap-3 px-5"
        style={{ paddingBottom: 'calc(44px + var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)))' }}
      >
        <Link
          to="/signup"
          onClick={() => trackSignupCtaClick('native_welcome')}
          className="flex h-[54px] w-full max-w-[350px] items-center justify-center rounded-[14px] bg-[#7c3aed] text-[17px] font-semibold tracking-[-0.012em] text-white shadow-[0_6px_18px_rgba(124,58,237,0.32)] transition-transform active:scale-[0.985]"
        >
          Create account
        </Link>
        <p className="py-2.5 text-sm">
          <span className="font-medium text-[#6e6779]">Already a member?</span>{' '}
          <Link to="/signin" className="font-semibold" style={{ color: BRAND_TEXT }}>
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
