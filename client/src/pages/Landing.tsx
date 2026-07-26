import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { InAppBrowserWarning, PublicNav } from '@/components'
import HockiaSocials from '@/components/HockiaSocials'
import StoreBadges from '@/components/StoreBadges'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useContactModal } from '@/lib/contact'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'

/**
 * Landing — the public marketing surface.
 *
 * Strategy (founder brief + funnel review, 2026-07-25): the funnel data showed
 * the drop is BEFORE signup, not inside onboarding (~95% of people who start
 * the wizard finish it), and that logged-out visitors already try to explore —
 * a third of opportunity views come from people with no account. So the page's
 * job is to SHOW the product, not describe it, and to offer "look around" as a
 * first-class action next to "sign up".
 *
 * Every screenshot here is the real product with real data, not an
 * illustration — that's the whole point: proof instead of claims.
 *
 * NOTE: this page scrolls, so it must NOT use useImmersiveChrome (that hook
 * locks body/html overflow for the old fixed full-screen dark hero).
 */

const EXPLORE_PATH = '/community'

/**
 * Reveal-on-scroll. Honours prefers-reduced-motion by showing immediately.
 *
 * SAFETY: marketing copy must never be permanently invisible. The animation is
 * a progressive enhancement, so there are three independent ways to become
 * visible — the observer, a scroll fallback, and an unconditional timeout — and
 * any one of them is enough. (Caught in review: full-page capture left the last
 * two sections blank because the observer never fired for them.)
 */
const REVEAL_FAILSAFE_MS = 1500

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    let done = false
    const reveal = () => {
      if (done) return
      done = true
      setShown(true)
    }

    // 1. Anything already within a viewport-and-a-bit shows straight away.
    const nearViewport = () => {
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight * 1.15 && r.bottom > 0
    }
    if (nearViewport()) reveal()

    // 2. The observer handles the normal scrolling case.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) reveal()
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0 },
    )
    io.observe(el)

    // 3. Belt-and-braces: a plain scroll listener, plus a timeout that reveals
    //    unconditionally so content can never be stranded.
    const onScroll = () => { if (nearViewport()) reveal() }
    window.addEventListener('scroll', onScroll, { passive: true })
    const t = window.setTimeout(reveal, REVEAL_FAILSAFE_MS)

    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(t)
    }
  }, [])

  return { ref, shown }
}

function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number
}) {
  const { ref, shown } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}

/**
 * Intrinsic pixel sizes of the mockups. Passed as width/height on every <img>
 * so the browser reserves the box before decode. Without these the page grew
 * ~400px (desktop) / ~1500px (mobile) underneath the reader as lazy images
 * landed — visible layout shift, and it also skewed landing_scroll_depth,
 * which measured against a document still growing.
 */
const MOCKUP_SIZE: Record<string, { w: number; h: number }> = {
  '/Mockup1.webp': { w: 590, h: 1280 },
  '/Mockup2.webp': { w: 461, h: 702 },
  '/Mockup3.webp': { w: 498, h: 623 },
  '/Mockup4.webp': { w: 500, h: 748 },
  '/Mockup5.webp': { w: 836, h: 640 },
}

interface FeatureSectionProps {
  eyebrow: string
  title: string
  body: string
  bullets: string[]
  image: string
  imageAlt: string
  /** Image on the right (default) or left. */
  flip?: boolean
  /** Phone shots need a narrower frame than the laptop shot. */
  narrow?: boolean
}

function FeatureSection({ eyebrow, title, body, bullets, image, imageAlt, flip, narrow }: FeatureSectionProps) {
  const size = MOCKUP_SIZE[image]
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className={`flex flex-col gap-10 md:gap-16 items-center ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`}>
          <Reveal className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-hockia-primary">{eyebrow}</p>
            <h2 className="mt-3 text-3xl md:text-[2.5rem] font-bold text-gray-900 leading-[1.15] tracking-tight text-balance">
              {title}
            </h2>
            <p className="mt-4 text-lg text-gray-600 leading-relaxed">{body}</p>
            <ul className="mt-6 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-hockia-primary/10">
                    <Check className="h-3 w-3 text-hockia-primary" strokeWidth={3} />
                  </span>
                  <span className="text-gray-700">{b}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal className="flex-1 min-w-0 w-full" delay={120}>
            <div className={`mx-auto ${narrow ? 'max-w-[300px]' : 'max-w-[560px]'}`}>
              <img
                src={image}
                alt={imageAlt}
                width={size?.w}
                height={size?.h}
                loading="lazy"
                decoding="async"
                className="w-full h-auto drop-shadow-2xl"
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

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

  // Light page: paint the native status bar for a light background. (No
  // useImmersiveChrome — it locks scrolling for the old fixed dark hero.)
  useEffect(() => {
    void setStatusBarForBackground('light-bg')
  }, [])

  // ── Funnel instrumentation ────────────────────────────────────────────────
  // The two CTAs and reading depth are the landing-specific events deliberately
  // held back from Phase 1 so they'd be built against THIS page rather than the
  // one it replaced. `page_view` (path='/') is already emitted app-wide.
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

  // Real <Link>s, not buttons: a conversion page's primary actions must
  // support cmd/middle-click "open in new tab" and be crawlable as links.
  // The click handler still fires the funnel event; navigation is the Link's.
  const ctaPair = (place: string) => (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
      <Link
        to={EXPLORE_PATH}
        onClick={() => handleCta('explore_hockia', place)}
        className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-hockia-primary to-hockia-secondary px-7 text-base font-semibold text-white shadow-lg shadow-hockia-primary/20 transition-all hover:shadow-xl hover:shadow-hockia-primary/30 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-hockia-primary/40 focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0 sm:w-auto"
      >
        Explore HOCKIA
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" />
      </Link>
      <Link
        to="/signup"
        onClick={() => handleCta('create_profile', place)}
        className="inline-flex h-14 w-full items-center justify-center rounded-2xl border border-gray-200 bg-white px-7 text-base font-semibold text-gray-900 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-hockia-primary/40 focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0 sm:w-auto"
      >
        Create your profile
      </Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <InAppBrowserWarning context="login" />
      <PublicNav transparent={false} />

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Soft violet wash + grid, brand-tinted rather than a generic gradient */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-[#f6f4ff] via-white to-white" />
          <div className="absolute -top-32 -right-24 h-[420px] w-[420px] rounded-full bg-hockia-primary/10 blur-3xl" />
          <div className="absolute top-40 -left-32 h-[380px] w-[380px] rounded-full bg-hockia-accent/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-14 pb-12 md:pt-20 md:pb-20">
          <div className="flex flex-col lg:flex-row lg:items-center gap-12 lg:gap-8">
            <div className="flex-1 min-w-0">
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100">
                  <span className="h-2 w-2 rounded-full bg-hockia-primary" />
                  Where field hockey sticks together.
                </span>

                <h1 className="mt-6 text-[2.5rem] leading-[1.06] sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 text-balance">
                  See what HOCKIA can do
                  <span className="block bg-gradient-to-r from-hockia-primary to-hockia-secondary bg-clip-text text-transparent">
                    before you join.
                  </span>
                </h1>

                <p className="mt-5 max-w-xl text-lg md:text-xl text-gray-600 leading-relaxed">
                  Explore players, coaches, clubs, opportunities and the global field hockey
                  community — then create your profile when you&apos;re ready.
                </p>

                <div className="mt-8">{ctaPair('hero')}</div>

                <div className="mt-9">
                  <p className="text-sm font-medium text-gray-500">
                    Use HOCKIA on the web — or take it with you.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <StoreBadges heightClass="h-11" source="landing_hero" />
                    <span className="text-sm text-gray-400">Web · iOS · Android</span>
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Device composition — real product, not an illustration. */}
            <Reveal className="flex-1 min-w-0 w-full" delay={140}>
              <div className="relative mx-auto max-w-[560px] lg:max-w-none">
                <img
                  src="/Mockup5.webp"
                  alt="The HOCKIA opportunities board, showing open roles at clubs across Europe"
                  width={836}
                  height={640}
                  className="w-full h-auto drop-shadow-2xl"
                  fetchPriority="high"
                  decoding="async"
                />
                <img
                  src="/Mockup4.webp"
                  alt="A HOCKIA player profile with an evidence checklist"
                  width={500}
                  height={748}
                  className="absolute -bottom-6 -right-2 w-[34%] max-w-[190px] h-auto drop-shadow-2xl sm:-right-4"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
            </Reveal>
          </div>

          {/* Proof strip — real figures from the live database. */}
          <Reveal delay={220}>
            <dl className="mt-16 grid grid-cols-2 gap-x-4 gap-y-8 border-t border-gray-100 pt-10 sm:grid-cols-4">
              {[
                ['258', 'members'],
                ['43', 'nationalities'],
                ['281', 'clubs mapped'],
                ['11', 'open roles'],
              ].map(([n, label]) => (
                <div key={label}>
                  <dt className="text-3xl font-extrabold tracking-tight text-gray-900 tabular-nums">{n}</dt>
                  <dd className="mt-1 text-sm text-gray-500">{label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* ─────────────── WHO IT'S FOR ─────────────── */}
      <section className="border-y border-gray-100 bg-[#fafafd] py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-hockia-primary">
              One platform. The whole ecosystem.
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl md:text-[2.5rem] font-bold leading-[1.15] tracking-tight text-gray-900 text-balance">
              Built for everyone who makes field hockey happen.
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { t: 'Players', d: 'Build the profile that gets you found, and find opportunities that fit.' },
              { t: 'Coaches', d: 'Show your coaching journey and connect with clubs that need you.' },
              { t: 'Clubs', d: 'Present your club, recruit with full context, and reach the wider hockey world.' },
              { t: 'Brands', d: 'Understand the community and find meaningful ways to take part in the sport.' },
              { t: 'Umpires', d: 'Be visible in the ecosystem and connect beyond the matchday.' },
              { t: 'Everyone else', d: 'One place for the people and organisations moving the sport forward.' },
            ].map((r, i) => (
              <Reveal key={r.t} delay={i * 60}>
                <div className="h-full rounded-2xl border border-gray-100 bg-white p-6 transition-all hover:border-hockia-primary/25 hover:shadow-lg hover:-translate-y-0.5 motion-reduce:hover:translate-y-0">
                  <h3 className="text-lg font-bold text-gray-900">{r.t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{r.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── WHAT'S INSIDE ─────────────── */}
      <FeatureSection
        eyebrow="Get found"
        title="A profile that answers the questions recruiters actually ask."
        body="Not a CV. Position, category, availability and the evidence behind it — so a club can judge fit in seconds instead of messaging to find out."
        bullets={[
          'Evidence checklist: footage, references, club, career history',
          'Profile strength shows exactly what is still missing',
          'Say when you are open to play or coach — and where',
        ]}
        image="/Mockup4.webp"
        imageAlt="A HOCKIA player profile showing an evidence checklist and open-to-play status"
        narrow
      />

      <div className="bg-[#fafafd] border-y border-gray-100">
        <FeatureSection
          eyebrow="Real opportunities"
          title="Open roles at real clubs, not a noticeboard."
          body="Filter by country, role, category and position. See who is recruiting right now, what they need, and apply without leaving the platform."
          bullets={[
            'Player, coach and staff openings from clubs worldwide',
            'Filter by country, category, position and EU passport',
            'Apply in-app — your profile is the application',
          ]}
          image="/Mockup5.webp"
          imageAlt="The HOCKIA opportunities board with open coach and player roles"
          flip
        />
      </div>

      <FeatureSection
        eyebrow="Your hockey story"
        title="Every club, season and achievement in one timeline."
        body="Career history that reads like a career — the clubs, the roles, the tournaments and what you actually did there."
        bullets={[
          'Clubs, seasons, roles and honours on one timeline',
          'Tournaments and achievements marked as they happened',
          'References from people you have actually played with',
        ]}
        image="/Mockup1.webp"
        imageAlt="A HOCKIA career history timeline showing clubs and achievements"
        narrow
      />

      <div className="bg-[#fafafd] border-y border-gray-100">
        <FeatureSection
          eyebrow="Show, don't tell"
          title="Highlights, full match footage and a gallery."
          body="Link the highlight reel, attach unedited match video for the coaches who want the full picture, and keep the photos that tell the rest of the story."
          bullets={[
            'Linked highlight video right on your profile',
            'Full match footage for deeper evaluation',
            'A gallery from matches, training and your career',
          ]}
          image="/Mockup3.webp"
          imageAlt="HOCKIA profile media: linked highlight video, full match footage and gallery"
          flip
          narrow
        />
      </div>

      <FeatureSection
        eyebrow="For clubs & recruiters"
        title="Judge fit with context, not a hunch."
        body="See how a candidate matches the specific role you posted, what evidence backs it up, and where the gaps are — before you spend a message."
        bullets={[
          'Fit assessed against the role you actually posted',
          'Evidence and profile completeness at a glance',
          'Message, save or shortlist straight from the preview',
        ]}
        image="/Mockup2.webp"
        imageAlt="A HOCKIA candidate preview showing role fit and supporting evidence"
        narrow
      />

      {/* ─────────────── CLOSING CTA ─────────────── */}
      <section className="relative overflow-hidden border-t border-gray-100">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-white to-[#f6f4ff]" />
          <div className="absolute -bottom-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-hockia-primary/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl px-6 py-20 md:py-28 text-center">
          <Reveal>
            <h2 className="text-3xl md:text-[2.75rem] font-bold leading-[1.12] tracking-tight text-gray-900 text-balance">
              Look around first.
              <span className="block text-hockia-primary">Join when it makes sense.</span>
            </h2>
            <p className="mt-5 text-lg text-gray-600">
              Browsing is open to everyone. You only need an account to apply, message or connect.
            </p>
            {/* 'closing_cta', not 'footer' — the footer is a separate element
                with no CTA, and a wrong label misleads whoever queries this. */}
            <div className="mt-8 flex justify-center">{ctaPair('closing_cta')}</div>

            <p className="mt-8 text-sm text-gray-500">
              Already have an account?{' '}
              <Link to="/signin" className="font-semibold text-hockia-primary hover:underline underline-offset-2">
                Sign in
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─────────────── FOOTER ─────────────── */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between">
            <img
              src="/brand/wordmark/hockia-wordmark-black.svg"
              alt="HOCKIA"
              // 153x42 viewBox — height pinned by CSS; declared so no image
              // on this page is missing intrinsic dimensions.
              width={153}
              height={42}
              className="h-7 object-contain"
              loading="lazy"
            />
            <HockiaSocials tone="muted" />
            <button
              type="button"
              onClick={openContact}
              className="text-sm text-gray-500 transition-colors hover:text-gray-900"
            >
              Questions? Contact us
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
