import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { hasPersistedSession } from '@/lib/persistedSession'
import NativeLaunchSplash from '@/components/NativeLaunchSplash'
import { buttonClassName } from '@/components/ui/buttonClasses'

/**
 * NativeWelcome — the first screen of the iOS / Android apps.
 *
 * Design: rebrand page 26 · Welcome (2026-10-25), on the founder-selected
 * single-CTA first run (Figma "02-F3", 2026-08-17). Someone opening the app from the App Store or Google
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
  // Stage height: the 488 design, yielding on short screens so the brand and
  // both actions fit (min 340). Computed here, not in CSS: dividing lengths
  // inside calc() (for the scale) is unsupported in older Android WebViews,
  // which dropped the whole transform and pushed the players off-screen.
  const [stageH, setStageH] = useState(() => welcomeStageHeight())
  useEffect(() => {
    const onResize = () => setStageH(welcomeStageHeight())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [storedSession] = useState(() => hasPersistedSession())
  const showWelcome = authLoading ? !storedSession : !user

  useEffect(() => {
    void setStatusBarForBackground(showWelcome ? 'light-bg' : 'dark-bg')
  }, [showWelcome])
  // Leaving for the (white) app: dark icons again. The violet launch canvas
  // above needs white ones, and with the web view under the status bar
  // (contentInset 'never') nothing else would switch them back.
  useEffect(() => () => void setStatusBarForBackground('light-bg'), [])

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
    <div className="relative flex min-h-screen-dvh w-full flex-col overflow-hidden bg-surface-subtle text-ink-1">
      {/* ── Stage (rebrand page 26 · Welcome): halo + the two full-body
          players (real photos, background removed; provenance and the
          players' and photographer's permission in docs/design-handoff) +
          the fade into the canvas. A fixed 390 × 488 design space, centred
          and scaled from the stage height so short phones (iPhone SE class) still
          fit the brand and both actions. ─────────────────────────────── */}
      <div
        className="relative w-full shrink-0"
        style={{
          height: stageH,
        }}
      >
        <div
          // Clipped top and bottom only: on phones wider than 390 the players
          // run to the screen edge (the page clips), never to a hard vertical
          // line inside it; below 488 nothing shows through.
          className="absolute left-1/2 top-0 origin-top"
          style={{ width: 390, height: 488, clipPath: 'inset(0 -240px)', transform: `translateX(-50%) scale(${stageH / 488})` }}
          aria-hidden="true"
        >
          <img src="/native/welcome-halo.svg" alt="" width={360} height={360} className="absolute max-w-none" style={{ left: 1, top: 96, width: 360, height: 360 }} draggable={false} />
          {/* Man (behind), 294 × 310 at (−38, 158) */}
          <img
            src="/native/player-man-fullbody.webp"
            alt=""
            width={587}
            height={620}
            fetchPriority="high"
            decoding="async"
            className="absolute max-w-none select-none object-contain"
            style={{ left: -38, top: 158, width: 294, height: 310 }}
            draggable={false}
          />
          {/* Woman (front), 238 × 460 at (108, 70) */}
          <img
            src="/native/player-woman-fullbody.webp"
            alt=""
            width={476}
            height={920}
            fetchPriority="high"
            decoding="async"
            className="absolute max-w-none select-none object-contain"
            style={{ left: 108, top: 70, width: 238, height: 460 }}
            draggable={false}
          />
          {/* Fade into the canvas from y 280 to 510, wider than the stage so
              it also covers the overflow on wide phones */}
          <div
            className="absolute bg-gradient-to-b from-surface-subtle/0 via-surface-subtle/85 via-[55%] to-surface-subtle to-[85%]"
            style={{ top: 280, height: 230, left: -240, width: 870 }}
          />
        </div>
      </div>

      {/* ── Brand: the vertical ink lockup + tagline ───────────────────── */}
      <div className="relative z-10 flex shrink-0 flex-col items-center gap-4 px-6">
        <img src="/brand/lockup/hockia-lockup-vertical-ink.svg" alt="Hockia" width={152} height={107} className="h-[107px] w-[152px]" />
        <h1 className="text-center text-[17px] leading-[1.45] tracking-[-0.005em] text-ink-2">Where field hockey sticks together.</h1>
      </div>

      <div className="min-h-[24px] flex-1" />

      {/* ── Actions: one Primary, one Tertiary ─────────────────────────── */}
      <div
        className="relative z-10 flex flex-col gap-3 px-6"
        style={{ paddingBottom: 'calc(16px + var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)))' }}
      >
        <Link
          to="/signup"
          onClick={() => trackSignupCtaClick('native_welcome')}
          className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}
          data-testid="welcome-get-started"
        >
          Get started
        </Link>
        <Link
          to="/signin"
          className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}
          data-testid="welcome-log-in"
        >
          I already have an account
        </Link>
      </div>
    </div>
  )
}

function welcomeStageHeight(): number {
  const h = typeof window === 'undefined' ? 844 : window.innerHeight
  return Math.min(488, Math.max(340, h - 356))
}
