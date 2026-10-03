import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { InAppBrowserWarning } from '@/components'
import HockiaSocials from '@/components/HockiaSocials'
import StoreBadges from '@/components/StoreBadges'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useInView, useReducedMotion, EASE_ENTRANCE, DUR_ENTRANCE } from '@/lib/motion'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useContactModal } from '@/lib/contact'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { fetchNewestOpenRoles, type OpenRoleCard } from '@/lib/landingRoles'

/**
 * Landing — the public marketing surface ("Web A v2").
 *
 * Design: Figma "Hockia-UI-UX" — mobile 111:1689, desktop 114:1743. Four
 * sections: Nav → Hero (phone cluster) → Open roles → Final CTA + footer.
 * One responsive component, not two trees: every section is the same DOM
 * styled per breakpoint, so the copy can never drift between sizes.
 *
 * Tokens: colours/radii from tailwind.config.js (Figma "Hockia / Color",
 * "Space & Radius"); the `web-*` type scale is the handoff's Inter set.
 * Motion: subtle fade-in reveals only (lib/motion.ts) — no glow, no shadow
 * animation, no parallax.
 *
 * Prerendered at build (scripts/prerender-landing.mjs): the <h1> text is the
 * script's sanity gate and must contain "The network for". The open-roles
 * section is client data, so the static HTML may or may not carry it; it
 * sits below the fold and simply appears after hydration.
 *
 * NOTE: this page scrolls, so it must NOT use useImmersiveChrome (that hook
 * locks body/html overflow for the old fixed full-screen dark hero).
 */

const EXPLORE_PATH = '/community'

/** Inside the iOS/Android app. Constant for the lifetime of the process. */
const isNativeApp = Capacitor.isNativePlatform()

/** Page container: 1200 max, 120 side margins fall out at 1440. */
const CONTAINER = 'mx-auto w-full max-w-[1200px] px-5 md:px-6 lg:px-10'
/** 768–1023 keeps the phone layout, centred at ~560. */
const PHONE_COL = 'mx-auto w-full max-w-[560px] lg:mx-0 lg:max-w-none'

/** Landing CTAs are crawlable links styled as the shared Button (radius 16
 *  per the Web A v2 frame; the app Button keeps 12/10). */
const PRIMARY_LARGE = buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-card' })
const PRIMARY_SMALL = buttonClassName({ variant: 'primary', size: 'small', radius: 'rounded-card' })

/**
 * Fade-in reveal on the shared motion system (lib/motion.ts). SAFETY,
 * inherited from useInView: marketing copy must never be permanently
 * invisible — three independent paths lead to visible and any one suffices.
 * The prerender script strips the opacity/transform inline styles so the
 * static HTML is fully visible before React boots.
 */
function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const reduced = useReducedMotion()
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(10px)',
        transition: reduced
          ? 'none'
          : `opacity ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${delay}ms, transform ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/* ────────────────────────── Nav ────────────────────────── */

const NAV_LINKS = [
  { to: EXPLORE_PATH, label: 'Explore' },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/world', label: 'For clubs' },
]

function LandingNav({ onCta }: { onCta: (cta: 'create_profile', place: string) => void }) {
  return (
    // index.html sets viewport-fit=cover, so each top surface must clear the
    // iOS notch itself. No-op in browsers (safe-area inset is 0).
    <nav aria-label="Primary" className="relative z-20 w-full bg-white pt-[env(safe-area-inset-top)]">
      <div className={`${CONTAINER} flex items-center justify-between py-2 lg:gap-8 lg:py-4`}>
        <Link to="/" className="flex h-11 shrink-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40" aria-label="HOCKIA home">
          <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="hidden h-7 w-auto lg:block" />
          <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" width={153} height={42} className="h-[18px] w-auto lg:h-5" />
        </Link>

        {/* Desktop links + actions */}
        <div className="hidden flex-1 items-center justify-end gap-8 lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="flex h-11 items-center rounded-lg text-web-subhead-strong text-ink-2 transition-colors hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
            >
              {l.label}
            </Link>
          ))}
          <Link
            to="/signin"
            className="flex h-11 items-center rounded-lg text-web-subhead-strong text-hockia-primary hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
          >
            Log in
          </Link>
          <Link to="/signup" onClick={() => onCta('create_profile', 'nav')} className={PRIMARY_SMALL}>
            Create a profile
          </Link>
        </div>

        {/* Mobile: wordmark + Log in only */}
        <Link
          to="/signin"
          className="-mr-2 flex h-11 items-center rounded-lg px-2 text-web-subhead-strong text-hockia-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 lg:hidden"
        >
          Log in
        </Link>
      </div>
    </nav>
  )
}

/* ─────────────────────── Phone cluster ─────────────────────── */

/**
 * Three real product screens in CSS device frames. The screenshots are
 * exports of the actual app — proof, not illustration. Frames are pure CSS
 * so the phones scale between breakpoints without shipping bezel images.
 */
function Phone({ src, alt, className, imgClassName = '', priority = false, screenW, screenH }: {
  src: string; alt: string; className?: string; imgClassName?: string; priority?: boolean
  screenW: number; screenH: number
}) {
  return (
    <div className={`relative rounded-[40px] bg-[#0b0b12] shadow-[0_12px_32px_-12px_rgba(15,15,20,0.28)] ${className ?? ''}`}>
      <img
        src={src}
        alt={alt}
        width={screenW}
        height={screenH}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={`absolute inset-[1.34%_2.86%] h-[97.32%] w-[94.28%] rounded-[32px] object-cover ${imgClassName}`}
      />
    </div>
  )
}

/** Authoring canvases — the Figma frames' dimensions. */
const CLUSTER_M = { w: 390, h: 470 }
const CLUSTER_D = { w: 507, h: 611 }

/**
 * Figma rotations are counter-clockwise, CSS rotate() is clockwise: the
 * frame's "left 6°, right −6°" is `-rotate-6` / `rotate-6` here. Positions
 * are the frame's (x, y) per phone, mobile → desktop.
 */
function PhoneCluster() {
  // The cluster is authored on a fixed canvas. Rather than a fixed box that
  // floats in dead space on a wide phone and overflows a narrow one, the
  // outer box takes its column's width and the canvas scales to fit it —
  // proportionally identical everywhere. Mobile: the outer phones bleed off
  // the screen edges (the hero clips at the viewport). Desktop: the frame
  // clips the outer phones at the 507×611 stage, as in Figma.
  //
  // The scale is a NUMBER, so it is measured in JS: CSS can't derive a
  // unitless ratio from `100vw / 390px`. ResizeObserver keeps it right on
  // rotation and on the 1024–1200 desktop range where the column narrows.
  const outerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => {
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches
      const canvas = isDesktop ? CLUSTER_D : CLUSTER_M
      setDesktop(isDesktop)
      setScale(Math.min(1, el.clientWidth / canvas.w))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const canvas = desktop ? CLUSTER_D : CLUSTER_M

  return (
    <div
      ref={outerRef}
      className="relative mx-auto w-full max-w-[390px] shrink-0 lg:max-w-none lg:overflow-hidden"
      // The canvas is absolutely positioned, so the box has no intrinsic
      // height — set it explicitly (including at exactly scale 1).
      style={{ height: canvas.h * scale }}
      data-cluster
    >
      <div
        className="absolute left-0 top-0 h-[470px] w-[390px] origin-top-left lg:h-[611px] lg:w-[507px]"
        style={{ transform: scale === 1 ? undefined : `scale(${scale})` }}
      >
        {/* Left — Community */}
        <div className="absolute left-[-24px] top-[64px] -rotate-6 lg:left-[-31px] lg:top-[83px]">
          <Phone
            src="/landing/phone-community.png"
            alt="Hockia community screen: players, coaches and clubs around the world"
            className="h-[366px] w-[172px] lg:h-[476px] lg:w-[224px]"
            screenW={390}
            screenH={844}
          />
        </div>
        {/* Right — Feed. Top-anchored so the HOCKIA header and Feed/Pulse tabs
            stay visible whatever sliver object-cover trims. */}
        <div className="absolute left-[242px] top-[52px] rotate-6 lg:left-[315px] lg:top-[68px]">
          <Phone
            src="/landing/phone-feed.jpg"
            alt="Hockia home feed: opportunities, milestones and community activity"
            className="h-[366px] w-[172px] lg:h-[476px] lg:w-[224px]"
            imgClassName="object-top"
            screenW={590}
            screenH={1280}
          />
        </div>
        {/* Front — First run */}
        <div className="absolute left-[97px] top-[16px] lg:left-[126px] lg:top-[21px]">
          <Phone
            src="/landing/phone-firstrun.webp"
            alt="Hockia app: your game, your network"
            className="h-[417px] w-[196px] lg:h-[542px] lg:w-[255px]"
            imgClassName="object-top"
            priority
            screenW={780}
            screenH={1688}
          />
        </div>
      </div>
    </div>
  )
}

/* ─────────────────── Open roles ─────────────────── */

function OpenRolesSection() {
  const [roles, setRoles] = useState<OpenRoleCard[]>([])

  // Read-only select on the public view (anon-readable). With no open roles
  // — or a failed read — the whole section stays hidden: the argument of
  // this band is "these are real", so there is no placeholder state.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchNewestOpenRoles()
        if (!cancelled) setRoles(rows)
      } catch (err) {
        logger.debug('[Landing] open roles unavailable', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (roles.length === 0) return null

  return (
    <section aria-labelledby="open-roles-title" className="bg-surface-subtle py-12 lg:py-24">
      <Reveal className={CONTAINER}>
        <div className={`${PHONE_COL} flex flex-col gap-3 lg:gap-6`}>
          <div className="flex flex-col gap-2 lg:gap-3">
            <p className="text-caption font-semibold uppercase tracking-[0.04em] text-hockia-primary">Open roles</p>
            <h2 id="open-roles-title" className="text-web-title-2 text-ink-1 lg:text-web-h2">
              Your next club could be anywhere.
            </h2>
          </div>

          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-6">
            {roles.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/opportunities/${r.id}`}
                  onClick={() => trackDbEvent('cta_click', undefined, undefined, { cta: 'open_role_teaser', location: 'opportunities_section' })}
                  className="flex items-center gap-3 rounded-card border border-line bg-white p-4 transition-colors hover:border-ink-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 lg:p-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:gap-1">
                    <span className="truncate text-web-headline text-ink-1 lg:text-web-title-3">{r.title}</span>
                    {r.meta && (
                      <span className="truncate text-web-footnote text-ink-3 lg:text-web-subhead">{r.meta}</span>
                    )}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-web-footnote text-ink-3 lg:text-web-subhead">Clubs publish real roles. Apply in the app.</p>
        </div>
      </Reveal>
    </section>
  )
}

/* ────────────────────────── Page ────────────────────────── */

export default function Landing() {
  const navigate = useNavigate()
  const openContact = useContactModal((s) => s.open)
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

  // Light page: paint the native status bar for a light background.
  useEffect(() => {
    void setStatusBarForBackground('light-bg')
  }, [])

  // ── Funnel instrumentation (unchanged from the previous landing) ──────────
  const firedDepths = useRef<Set<number>>(new Set())
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      if (scrollable <= 0) return
      const pct = Math.round((window.scrollY / scrollable) * 100)
      for (const mark of [25, 50, 75, 100]) {
        if (pct >= mark && !firedDepths.current.has(mark)) {
          firedDepths.current.add(mark)
          trackDbEvent('landing_scroll_depth', undefined, undefined, { pct: mark })
        }
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Navigation itself belongs to the <Link>; this only records the funnel
  // event, so cmd/middle-click still opens a new tab and is still counted.
  const handleCta = useCallback(
    (cta: 'explore_hockia' | 'create_profile', place: string) => {
      trackDbEvent('cta_click', undefined, undefined, { cta, location: place })
      if (cta === 'create_profile') trackSignupCtaClick(`landing_${place}`)
    },
    [],
  )

  // ── Redirect already-authenticated users out ──
  useEffect(() => {
    logger.debug('[LANDING] Auth state check', {
      hasUser: !!user, hasProfile: !!profile, profileStatus, authLoading,
    })
    if (authLoading) return

    if (user && profile) {
      // Open-redirect guard: `redirectTo` traces back to the untrusted
      // `?next=` param / location.state.from.
      const destination = safeRedirectPath(redirectTo, '/dashboard/profile')
      try {
        sessionStorage.removeItem('hockia-redirect-after-login')
      } catch {
        /* noop */
      }
      navigate(destination)
    } else if (
      user && !profile &&
      (profileStatus === 'missing' || profileStatus === 'error' || profileStatus === 'loaded')
    ) {
      navigate('/complete-profile')
    }
  }, [user, profile, profileStatus, authLoading, navigate, redirectTo])

  return (
    <div className="min-h-screen bg-white text-ink-1">
      <InAppBrowserWarning context="login" />
      <LandingNav onCta={handleCta} />

      <main>
        {/* ───────────── S1 · Hero ───────────── */}
        <section aria-labelledby="hero-title" className="overflow-x-clip">
          <div className={`${CONTAINER} lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,507px)] lg:items-center lg:gap-16 lg:py-[72px]`}>
            <div className={`${PHONE_COL} flex flex-col gap-5 pb-2 pt-8 lg:gap-6 lg:py-0`}>
              <Reveal>
                <h1 id="hero-title" className="text-web-display-m text-ink-1 lg:text-web-display">
                  The network for
                  <br className="hidden lg:block" />
                  {' '}
                  <span className="text-hockia-primary">field hockey.</span>
                </h1>
              </Reveal>

              <Reveal delay={60}>
                <p className="text-web-body text-ink-2 lg:max-w-[460px] lg:text-web-lead">
                  Build your hockey profile, connect with clubs worldwide and find your next move.
                </p>
              </Reveal>

              <Reveal delay={120}>
                <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-6">
                  <Link
                    to="/signup"
                    onClick={() => handleCta('create_profile', 'hero')}
                    className={`${PRIMARY_LARGE} w-full lg:w-auto`}
                  >
                    Create a profile
                  </Link>
                  <Link
                    to={EXPLORE_PATH}
                    onClick={() => handleCta('explore_hockia', 'hero')}
                    className="group inline-flex h-11 items-center gap-1 rounded-lg text-web-subhead-strong text-hockia-primary hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 lg:text-web-body-strong"
                  >
                    Explore without an account
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={160}>
                <p className="text-center text-web-footnote text-ink-3 lg:text-left lg:text-web-subhead">
                  For players, coaches, clubs, umpires and brands.
                </p>
              </Reveal>
            </div>

            {/* App visual. Mobile: a full-bleed block (pad 24/40) whose canvas
                scales to the viewport, outer phones running off both edges.
                Desktop: the 507×611 stage in the right column. */}
            <Reveal delay={120} className="-mx-5 pb-10 pt-6 md:-mx-6 lg:mx-0 lg:py-0">
              <PhoneCluster />
            </Reveal>
          </div>
        </section>

        {/* ───────────── S2 · Open roles (client data; hidden at 0) ───────────── */}
        <OpenRolesSection />

        {/* ───────────── S3 · Final CTA ───────────── */}
        <section aria-labelledby="final-title" className="pb-10 pt-14 lg:pb-12 lg:pt-28">
          <Reveal className={CONTAINER}>
            <div className={`${PHONE_COL} flex flex-col items-center gap-5 lg:gap-6`}>
              <h2 id="final-title" className="max-w-[640px] text-center text-web-display-m text-ink-1 lg:text-web-display">
                One community for the whole game.
              </h2>

              <Link
                to="/signup"
                onClick={() => handleCta('create_profile', 'closing_cta')}
                className={`${PRIMARY_LARGE} w-full lg:w-auto lg:min-w-[184px]`}
              >
                Create a profile
              </Link>

              {/* Store links are pointless (and Apple-frowned-upon) inside the app */}
              {!isNativeApp && (
                <div data-store-badges className="flex justify-center">
                  <StoreBadges heightClass="h-11" source="landing_footer" className="justify-center" />
                </div>
              )}

              <p className="text-web-footnote text-ink-3 lg:text-web-subhead">
                Already a member?{' '}
                <Link to="/signin" className="text-web-subhead-strong text-hockia-primary hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 rounded">
                  Log in
                </Link>
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ───────────── Footer ───────────── */}
      <footer className={`${CONTAINER} mt-6 lg:mt-14`}>
        <div className="flex items-center justify-between gap-4 border-t border-line py-4 lg:py-6">
          <img
            src="/brand/wordmark/hockia-wordmark-black.svg"
            alt="HOCKIA"
            width={153}
            height={42}
            className="hidden h-4 w-auto lg:block"
          />
          <HockiaSocials tone="ink" iconClassName="h-5 w-5" className="-ml-3 lg:hidden" />
          <div className="flex items-center gap-2 lg:gap-4">
            <button
              type="button"
              onClick={openContact}
              className="flex h-11 items-center rounded-lg text-web-footnote text-ink-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 lg:text-web-subhead"
            >
              team@inhockia.com
            </button>
            <HockiaSocials tone="ink" iconClassName="h-4 w-4" className="-mr-3 hidden lg:flex" />
          </div>
        </div>
      </footer>
    </div>
  )
}
