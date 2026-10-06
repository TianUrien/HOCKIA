import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { InAppBrowserWarning } from '@/components'
import HockiaSocials from '@/components/HockiaSocials'
import StoreBadges from '@/components/StoreBadges'
import { CrestStrip, RoleCard } from '@/components/landing/RoleCards'
import { webButtonClassName, WEB_LINK_CHEVRON } from '@/components/ui/buttonClasses'
import { useInView, useReducedMotion, prefersReducedMotion, PRERENDERED } from '@/lib/motion'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useContactModal } from '@/lib/contact'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { fetchLandingRoles, type LandingRoles } from '@/lib/landingRoles'
import { useScrolled } from '@/hooks/useScrolled'

/**
 * Landing — the public marketing surface ("Landing v3", approved 6 Oct 2026).
 *
 * Design: Figma "Hockia-UI-UX" section "Landing v3" 122:1885 — desktop
 * 124:1908, mobile 126:2030; scrolled navbar 140:518 / 140:695; buttons
 * 122:1982 (+ "on dark" 141:534); motion 139:518. Four sections: fixed nav →
 * white hero (phone stage) → open roles → the dark closing panel + footer.
 * One responsive component, not two trees: every section is the same DOM
 * styled per breakpoint, so the copy can never drift between sizes.
 *
 * Tokens: colours/radii from tailwind.config.js (Figma "Hockia / App");
 * the `web3-*` type scale is the handoff's Inter set.
 *
 * Motion (globals.css "LANDING v3 MOTION"): CSS keyframes gated on the
 * `lv3-enter` class, which is set at hydration only — the static HTML is
 * the FINAL state, so the prerender and a no-JS read never hide content,
 * and nothing shifts layout. Everything is off under prefers-reduced-motion.
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
const ROLES_PATH = '/opportunities'

/** Inside the iOS/Android app. Constant for the lifetime of the process. */
const isNativeApp = Capacitor.isNativePlatform()

/** Page container: 1200 of content at 120 side margins on a 1440 viewport.
 *  max-w is the OUTER box (padding included): 1280 − 2×40 = 1200 of content,
 *  centred → 120 each side. Phones: 20 px gutters. */
const CONTAINER = 'mx-auto w-full max-w-[1280px] px-5 lg:px-10'

const PRIMARY_L = webButtonClassName({ variant: 'primary', size: 'large' })
const PRIMARY_M = webButtonClassName({ variant: 'primary', size: 'medium' })
const SECONDARY_M = webButtonClassName({ variant: 'secondary', size: 'medium' })
const LINK_L = webButtonClassName({ variant: 'link', size: 'large' })
const LINK_M = webButtonClassName({ variant: 'link', size: 'medium' })

/* ────────────────────────── Motion helpers ────────────────────────── */

/**
 * True once the page should play its load choreography. False on the
 * prerendered load (the visitor has been reading the static HTML already),
 * false under reduced motion. Computed at the first client render so the
 * very first paint already carries the class — no visible→hidden→visible
 * flash — while the static HTML (no class) stays final.
 */
function useEntrance(): boolean {
  const [enter] = useState(
    () =>
      typeof window !== 'undefined' &&
      !PRERENDERED &&
      // The prerender snapshot itself (scripts/prerender-landing.mjs sets
      // __PRERENDER__): the captured HTML must carry no animation class.
      !(window as unknown as { __PRERENDER__?: boolean }).__PRERENDER__ &&
      !prefersReducedMotion(),
  )
  const reduced = useReducedMotion()
  return enter && !reduced
}

/**
 * One-shot fade-up on enter (the closing panel; 16 px). Inline styles, like
 * the previous landing: the prerender script strips `opacity: 0` so the
 * static HTML is fully visible, and useInView has three independent paths
 * to visible — marketing copy is never stranded invisible.
 */
function Reveal({ children, className = '', distance = 16 }: {
  children: React.ReactNode; className?: string; distance?: number
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const reduced = useReducedMotion()
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : `translateY(${distance}px)`,
        transition: reduced ? 'none' : 'opacity 600ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {children}
    </div>
  )
}

/* ────────────────────────── Nav ────────────────────────── */

const NAV_LINKS = [
  { to: EXPLORE_PATH, label: 'Explore' },
  { to: ROLES_PATH, label: 'Opportunities' },
  { to: '/world', label: 'For clubs' },
]

function Logo({ wordmarkClass = '' }: { wordmarkClass?: string }) {
  return (
    <>
      <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="h-7 w-auto" />
      <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" width={153} height={42} className={`h-[18px] w-auto ${wordmarkClass}`} />
    </>
  )
}

/**
 * Fixed. Transparent and full width at the top; past scrollY 8 it morphs
 * into a floating glass capsule (240 ms; width, height, padding, radius,
 * background and shadow all transition). The phone capsule is the symbol +
 * Log in + Create a profile; the top state is logo + Log in only.
 */
export function LandingNav({ onCta }: { onCta: (cta: 'create_profile', place: string) => void }) {
  const scrolled = useScrolled()
  return (
    // index.html sets viewport-fit=cover, so each top surface must clear the
    // iOS notch itself. No-op in browsers (safe-area inset is 0).
    <nav
      aria-label="Primary"
      data-state={scrolled ? 'scrolled' : 'top'}
      className={`fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[padding] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
        scrolled ? 'px-3 pt-[calc(env(safe-area-inset-top)+12px)] lg:px-0' : 'px-0'
      }`}
    >
      <div
        data-testid="nav-bar"
        className={`mx-auto flex w-full items-center justify-between rounded-full border transition-[max-width,height,padding,background-color,border-color,box-shadow] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
          scrolled
            ? 'h-12 max-w-[1040px] border-line bg-white/[0.72] pl-3 pr-2 shadow-[0_8px_24px_rgba(15,15,20,0.08),0_1px_2px_rgba(15,15,20,0.04)] backdrop-blur-[20px] lg:h-14 lg:pl-5 lg:pr-3'
            : 'h-[60px] max-w-[1280px] border-transparent bg-transparent px-5 shadow-none lg:h-[72px] lg:px-10'
        }`}
      >
        <Link
          to="/"
          className="flex h-11 shrink-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="HOCKIA home"
        >
          <Logo wordmarkClass={scrolled ? 'hidden lg:block' : ''} />
        </Link>

        {/* Desktop links */}
        <div className="hidden flex-1 items-center justify-center gap-8 lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="flex h-11 items-center rounded-lg text-[14px] font-medium leading-5 text-ink-2 transition-colors hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <Link to="/signin" className={SECONDARY_M}>
            Log in
          </Link>
          <Link
            to="/signup"
            onClick={() => onCta('create_profile', 'nav')}
            className={`${PRIMARY_M} ${scrolled ? '' : 'hidden lg:inline-flex'}`}
          >
            Create a profile
          </Link>
        </div>
      </div>
    </nav>
  )
}

/* ─────────────────────── Phone stage ─────────────────────── */

/**
 * A real product screen in a CSS device frame. The screenshots are exports
 * of the actual app — proof, not illustration. The frame is pure CSS and
 * sizes from its container (`cqw`), so the phones scale between breakpoints
 * without shipping bezel images and with no JS measurement: the stage is a
 * fixed-aspect box and each phone a percentage of it.
 */
function Phone({ src, alt, className, imgClassName = '', priority = false, screenW, screenH }: {
  src: string; alt: string; className?: string; imgClassName?: string; priority?: boolean
  screenW: number; screenH: number
}) {
  return (
    <div
      className={`relative rounded-[15.7cqw] bg-[#0b0b12] shadow-[0_24px_48px_rgba(108,43,217,0.16),0_4px_10px_rgba(108,43,217,0.06)] [container-type:inline-size] ${className ?? ''}`}
    >
      <img
        src={src}
        alt={alt}
        width={screenW}
        height={screenH}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={`absolute inset-[1.34%_2.86%] h-[97.32%] w-[94.28%] rounded-[12.5cqw] object-cover ${imgClassName}`}
      />
    </div>
  )
}

/**
 * Stage 560×560 on desktop (phones at 0.88 / 0.88 / 0.92 of their 224×476 /
 * 255×542 frames: left x36 y96, right x327 y80, front x163 y30) and
 * 350×412 on phones (0.66 / 0.66 / 0.68). Positions and sizes are the
 * frame's values as percentages of the stage, so every phone is WHOLE at
 * every width. Rotation: left −6°, right +6°, front 0.
 *
 * Wrapper order per phone: entrance (data-phone) → float (data-float) →
 * rotation → frame. Each animation owns one element, so none overwrites
 * another's transform.
 */
function PhoneStage() {
  return (
    <div
      className="relative mx-auto aspect-[350/412] w-full max-w-[350px] lg:aspect-square lg:max-w-[560px]"
      data-stage
    >
      {/* Left — Community */}
      <div data-phone="left" className="absolute left-[5.14%] top-[17%] w-[42.29%] lg:left-[6.43%] lg:top-[17.14%] lg:w-[35.18%]">
        <div data-float style={{ '--float-delay': '-2s' } as React.CSSProperties}>
          <div className="-rotate-6">
            <Phone
              src="/landing/phone-community.png"
              alt="Hockia community screen: players, coaches and clubs around the world"
              className="aspect-[224/476] w-full"
              screenW={390}
              screenH={844}
            />
          </div>
        </div>
      </div>
      {/* Right — Feed. Top-anchored so the HOCKIA header and Feed/Pulse tabs
          stay visible whatever sliver object-cover trims. */}
      <div data-phone="right" className="absolute left-[52.57%] top-[14.08%] w-[42.29%] lg:left-[58.39%] lg:top-[14.29%] lg:w-[35.18%]">
        <div data-float style={{ '--float-delay': '-4s' } as React.CSSProperties}>
          <div className="rotate-6">
            <Phone
              src="/landing/phone-feed.jpg"
              alt="Hockia home feed: opportunities, milestones and community activity"
              className="aspect-[224/476] w-full"
              imgClassName="object-top"
              screenW={590}
              screenH={1280}
            />
          </div>
        </div>
      </div>
      {/* Front — First run */}
      <div data-phone="front" className="absolute left-[25.29%] top-[4.85%] w-[49.43%] lg:left-[29.11%] lg:top-[5.36%] lg:w-[41.89%]">
        <div data-float style={{ '--float-delay': '0s' } as React.CSSProperties}>
          <Phone
            src="/landing/phone-firstrun.webp"
            alt="Hockia app: your game, your network"
            className="aspect-[255/542] w-full"
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
  const [data, setData] = useState<LandingRoles>({ roles: [], crests: [] })
  // "Posted 3d" is relative to one clock, fixed when the data arrives.
  const [now] = useState(() => new Date())

  // Read-only select on the public view (anon-readable). With no open roles
  // — or a failed read — the whole section stays hidden: the argument of
  // this band is "these are real", so there is no placeholder state.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchLandingRoles(now)
        if (!cancelled) setData(rows)
      } catch (err) {
        logger.debug('[Landing] open roles unavailable', err)
      }
    })()
    return () => { cancelled = true }
  }, [now])

  if (data.roles.length === 0) return null

  const seeAll = (place: string) => (
    <Link
      to={ROLES_PATH}
      onClick={() => trackDbEvent('cta_click', undefined, undefined, { cta: 'open_roles_all', location: place })}
      className={`${LINK_M} h-5`}
    >
      See all open roles
      <ChevronRight className={WEB_LINK_CHEVRON} aria-hidden="true" />
    </Link>
  )

  return (
    <section aria-labelledby="open-roles-title" className="bg-white pb-12 pt-12 lg:pb-20 lg:pt-10">
      <div className={`${CONTAINER} flex flex-col gap-5 lg:gap-8`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="flex flex-col gap-3">
            <p className="text-web3-eyebrow uppercase text-brand-primary">Open roles</p>
            <h2 id="open-roles-title" className="text-[32px] font-extrabold leading-[38px] tracking-[-0.02em] text-ink-1 lg:text-web3-h2">
              Your next club could be anywhere.
            </h2>
          </div>
          <div className="hidden shrink-0 pb-1 lg:block">{seeAll('open_roles_header')}</div>
        </div>

        <CrestStrip crests={data.crests} />

        {/* Phones: 300-wide cards in a scroll-snap rail that bleeds through
            the gutters, the next card peeking. Desktop: three columns. */}
        <ul
          className="snap-rail -mx-5 flex gap-3 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
          aria-label="Open roles"
        >
          {data.roles.map((r) => (
            <li key={r.id} className="w-[300px] shrink-0 snap-start lg:w-auto">
              <RoleCard
                role={r}
                now={now}
                onClick={() => trackDbEvent('cta_click', undefined, undefined, { cta: 'open_role_teaser', location: 'opportunities_section' })}
              />
            </li>
          ))}
        </ul>

        <div className="lg:hidden">{seeAll('open_roles_footer')}</div>
      </div>
    </section>
  )
}

/* ────────────────────────── Page ────────────────────────── */

export default function Landing() {
  const navigate = useNavigate()
  const openContact = useContactModal((s) => s.open)
  const location = useLocation()
  const { user, profile, profileStatus, loading: authLoading } = useAuthStore()
  const enter = useEntrance()

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
        <section
          aria-labelledby="hero-title"
          data-testid="hero"
          className={`overflow-x-clip pt-[calc(env(safe-area-inset-top)+60px)] lg:pt-[72px] ${enter ? 'lv3-enter' : ''}`}
        >
          <div className={`${CONTAINER} flex flex-col gap-5 pb-10 pt-6 lg:grid lg:grid-cols-[minmax(440px,1fr)_minmax(400px,560px)] lg:items-center lg:gap-16 lg:pb-20 lg:pt-10`}>
            <div className="mx-auto flex w-full max-w-[560px] flex-col lg:mx-0 lg:max-w-none">
              <h1 id="hero-title" className="text-web3-display-m text-ink-1 lg:text-[48px] lg:leading-[1] xl:text-web3-display">
                <span className="block" data-enter style={{ '--d': '0ms' } as React.CSSProperties}>The network for</span>
                <span className="block text-brand-primary" data-enter style={{ '--d': '80ms' } as React.CSSProperties}>field hockey.</span>
              </h1>

              <p className="mt-5 text-web3-body text-ink-2 lg:max-w-[500px] lg:text-web3-lead" data-enter style={{ '--d': '200ms' } as React.CSSProperties}>
                Build your hockey profile, connect with clubs worldwide and find your next move.
              </p>

              <div className="mt-6 flex flex-col items-center gap-4 lg:mt-8 lg:flex-row lg:flex-wrap lg:gap-x-6 lg:gap-y-3" data-enter style={{ '--d': '320ms' } as React.CSSProperties}>
                <Link
                  to="/signup"
                  onClick={() => handleCta('create_profile', 'hero')}
                  className={`${PRIMARY_L} w-full lg:w-auto`}
                >
                  Create a profile
                </Link>
                <Link
                  to={EXPLORE_PATH}
                  onClick={() => handleCta('explore_hockia', 'hero')}
                  className={LINK_L}
                >
                  Explore without an account
                  <ChevronRight className={WEB_LINK_CHEVRON} aria-hidden="true" />
                </Link>
              </div>

              <p className="mt-4 text-center text-[13px] leading-[18px] text-ink-3 lg:text-left" data-enter style={{ '--d': '380ms' } as React.CSSProperties}>
                For players, coaches, clubs, umpires and brands.
              </p>

              {/* Desktop: divider + "Get the app" row inside the copy column.
                  Phones: the same row sits under the stage (below). Store
                  links are pointless (and Apple-frowned-upon) inside the app. */}
              {!isNativeApp && (
                <div className="hidden lg:block" data-enter style={{ '--d': '440ms' } as React.CSSProperties}>
                  <hr className="mt-10 w-[480px] max-w-full border-0 border-t border-line" />
                  <div data-store-badges="hero" className="mt-5 flex items-center gap-4">
                    <span className="text-[13px] font-semibold leading-[18px] text-ink-3">Get the app</span>
                    <StoreBadges heightClass="h-11" source="landing_hero" />
                  </div>
                </div>
              )}
            </div>

            {/* App visual: the phone stage. */}
            <div className="pt-4 lg:pt-0">
              <PhoneStage />
            </div>

            {!isNativeApp && (
              <div data-store-badges="hero-mobile" className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3 pt-2 lg:hidden" data-enter style={{ '--d': '440ms' } as React.CSSProperties}>
                <span className="text-[13px] font-semibold leading-[18px] text-ink-3">Get the app</span>
                <StoreBadges heightClass="h-11" source="landing_hero" className="justify-center" />
              </div>
            )}
          </div>
        </section>

        {/* ───────────── S2 · Open roles (client data; hidden at 0) ───────────── */}
        <OpenRolesSection />

        {/* ───────────── S3 · Closing panel ───────────── */}
        <section aria-labelledby="final-title" className="pb-16 pt-12 lg:pb-20 lg:pt-12">
          <Reveal className={CONTAINER} distance={16}>
            <div
              data-testid="closing-panel"
              className="relative isolate overflow-hidden rounded-[20px] border border-white/[0.08] px-6 py-10 text-center shadow-[0_24px_64px_rgba(59,18,138,0.28)] lg:rounded-panel lg:p-16"
              style={{
                backgroundImage:
                  'radial-gradient(ellipse 70% 80% at 18% 85%, rgba(167,139,250,0.55) 0%, rgba(167,139,250,0) 60%), linear-gradient(135deg, #1a0a45 0%, #3b128a 55%, #6c2bd9 100%)',
              }}
            >
              {/* Watermark: the symbol, white at 6 %, cropped bottom-right. */}
              <img
                src="/brand/svg/hockia-logo-white.svg"
                alt=""
                aria-hidden="true"
                width={300}
                height={243}
                className="pointer-events-none absolute -bottom-12 -right-[76px] h-[220px] w-auto opacity-[0.06] lg:-bottom-[79px] lg:-right-[124px] lg:h-[360px]"
              />

              <div className="relative flex flex-col items-center gap-5 lg:gap-6">
                <h2 id="final-title" className="max-w-[640px] text-[30px] font-extrabold leading-[36px] tracking-[-0.02em] text-white lg:text-web3-h2">
                  One community for
                  <br />
                  the whole game.
                </h2>
                <p className="max-w-[560px] text-web3-body text-white/[0.72] lg:text-web3-lead">
                  Free for players, coaches, clubs, umpires and brands.
                </p>

                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                  <Link
                    to="/signup"
                    onClick={() => handleCta('create_profile', 'closing_cta')}
                    className={webButtonClassName({ variant: 'onDarkPrimary', size: 'large', className: 'w-full sm:w-auto' })}
                  >
                    Create a profile
                  </Link>
                  <Link
                    to="/signin"
                    className={webButtonClassName({ variant: 'onDarkSecondary', size: 'large', className: 'w-full sm:w-auto' })}
                  >
                    Log in
                  </Link>
                </div>

                {/* Store links are pointless (and Apple-frowned-upon) inside the app */}
                {!isNativeApp && (
                  <div data-store-badges className="flex justify-center">
                    <StoreBadges heightClass="h-11" source="landing_footer" className="justify-center" />
                  </div>
                )}
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ───────────── Footer ───────────── */}
      <footer className={CONTAINER}>
        <div className="flex items-center justify-between gap-4 border-t border-line pb-8 pt-8 lg:pb-10">
          <img
            src="/brand/wordmark/hockia-wordmark-black.svg"
            alt="HOCKIA"
            width={153}
            height={42}
            className="hidden h-[18px] w-auto lg:block"
          />
          <HockiaSocials tone="ink" iconClassName="h-5 w-5" className="-ml-3 lg:hidden" />
          <div className="flex items-center gap-2 lg:gap-4">
            <button
              type="button"
              onClick={openContact}
              className="flex h-11 items-center rounded-lg text-[14px] leading-5 text-ink-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring lg:text-[15px]"
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
