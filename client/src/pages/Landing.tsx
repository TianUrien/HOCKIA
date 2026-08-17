import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ChevronRight, Menu, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { InAppBrowserWarning } from '@/components'
import HockiaSocials from '@/components/HockiaSocials'
import StoreBadges from '@/components/StoreBadges'
import LandingStats from '@/components/landing/LandingStats'
import {
  useInView,
  useParallax,
  useReducedMotion,
  EASE_ENTRANCE,
  DUR_ENTRANCE,
} from '@/lib/motion'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useContactModal } from '@/lib/contact'
import { safeRedirectPath } from '@/lib/safeRedirect'
import { trackSignupCtaClick } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setStatusBarForBackground } from '@/lib/nativeUi'

/**
 * Landing — the public marketing surface.
 *
 * Design: Figma "Web A · Product first" (desktop, node 22:411) and
 * "Web A · Product first — Mobile" (node 48:1613), founder-selected
 * 2026-08-15. One responsive component, not two trees: every section is the
 * same DOM styled per breakpoint, so the copy can never drift between sizes.
 *
 * Strategy carried over from the funnel review (2026-07-25): the drop is
 * BEFORE signup, so the page SHOWS the product — real screenshots, live
 * numbers, real open roles — and offers "look around" beside "sign up".
 *
 * NOTE: this page scrolls, so it must NOT use useImmersiveChrome (that hook
 * locks body/html overflow for the old fixed full-screen dark hero).
 */

const EXPLORE_PATH = '/community'

/** Inside the iOS/Android app. Constant for the lifetime of the process. */
const isNativeApp = Capacitor.isNativePlatform()

/** Design tokens from the Figma frame — named so a retune touches one line. */
const INK = '#2b2a33' // semantic/text/primary
const INK_2 = '#504f59' // semantic/text/secondary
const INK_3 = '#6e6779' // semantic/text/tertiary
const BRAND_TEXT = '#5b21b6' // semantic/text/brand
const BRAND_SOLID = '#7c3aed' // semantic/bg/brand-solid

/**
 * Reveal-on-scroll, on the shared motion system (lib/motion.ts).
 * SAFETY, inherited from useInView: marketing copy must never be permanently
 * invisible — three independent paths lead to visible and any one suffices.
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
        transform: inView ? 'translateY(0)' : 'translateY(18px)',
        transition: reduced
          ? 'none'
          : `opacity ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${delay}ms, transform ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/** Scroll-linked drift for the phone cluster. Small on purpose — parallax
 *  past ~40px stops reading as depth and starts reading as a bug. */
function Parallax({ children, range = 18, className = '' }: {
  children: React.ReactNode; range?: number; className?: string
}) {
  const ref = useParallax<HTMLDivElement>(range)
  return <div ref={ref} className={className}>{children}</div>
}

/* ────────────────────────── Nav ────────────────────────── */

function LandingNav({ onCta }: { onCta: (cta: 'create_profile', place: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const links = [
    { to: EXPLORE_PATH, label: 'Explore' },
    { to: '/opportunities', label: 'Opportunities' },
    { to: '/world', label: 'For clubs' },
  ]

  return (
    // index.html sets viewport-fit=cover, so each top surface must clear the
    // iOS notch itself. No-op in browsers (safe-area inset is 0).
    <nav className="relative z-20 w-full border-b border-[#e4e3eb] bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center justify-between pl-5 pr-4 lg:h-[76px] lg:gap-8 lg:px-[72px]">
        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="HOCKIA home">
          <img src="/brand/svg/hockia-logo-violet.svg" alt="" width={300} height={243} className="h-6 w-auto lg:h-7" />
          <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" width={153} height={42} className="h-3.5 w-auto lg:h-[17px]" />
        </Link>

        {/* Desktop links + actions */}
        <div className="hidden flex-1 items-center gap-8 lg:flex">
          <span className="w-2.5" aria-hidden="true" />
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="text-sm font-medium text-[#504f59] transition-colors hover:text-[#2b2a33]">
              {l.label}
            </Link>
          ))}
          <span className="flex-1" aria-hidden="true" />
          <Link to="/signin" className="text-sm font-semibold text-[#5b21b6] hover:underline underline-offset-4">
            Log in
          </Link>
          <Link
            to="/signup"
            onClick={() => onCta('create_profile', 'nav')}
            className="rounded-xl bg-[#7c3aed] px-5 py-[11px] text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#6d28d9] active:scale-[0.98]"
          >
            Create a profile
          </Link>
        </div>

        {/* Mobile actions */}
        <div className="flex items-center gap-2 lg:hidden">
          <Link to="/signin" className="rounded-full bg-[#f4f1ff] px-4 py-2 text-sm font-semibold text-[#5b21b6]">
            Log in
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#2b2a33] hover:bg-gray-100"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-[#e4e3eb] bg-white px-5 py-3 lg:hidden">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-2 py-3 text-[15px] font-medium text-[#2b2a33] hover:bg-gray-50"
            >
              {l.label}
            </Link>
          ))}
          <Link
            to="/signup"
            onClick={() => { setMenuOpen(false); onCta('create_profile', 'nav_menu') }}
            className="mt-2 block rounded-xl bg-[#7c3aed] px-2 py-3 text-center text-[15px] font-semibold text-white"
          >
            Create a profile
          </Link>
        </div>
      )}
    </nav>
  )
}

/* ─────────────────────── Phone cluster ─────────────────────── */

/**
 * Three real product screens in CSS device frames (Figma 22:479 / 48:1689).
 * The screenshots are exports of the actual app — proof, not illustration.
 * Frames are pure CSS so the phones scale between breakpoints without
 * shipping device-bezel images.
 */
function Phone({ src, alt, className, imgClassName = '', priority = false, screenW, screenH }: {
  src: string; alt: string; className?: string; imgClassName?: string; priority?: boolean
  screenW: number; screenH: number
}) {
  return (
    <div className={`rounded-[42px] bg-[#0b0b12] ${className ?? ''}`}>
      <img
        src={src}
        alt={alt}
        width={screenW}
        height={screenH}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={`absolute inset-[1.34%_2.86%] h-[97.32%] w-[94.28%] rounded-[34px] object-cover ${imgClassName}`}
      />
    </div>
  )
}

/** Authoring canvas of the mobile cluster — the Figma frame's dimensions. */
const CLUSTER_W = 390
const CLUSTER_H = 470

function PhoneCluster() {
  // MOBILE: the cluster is authored on a 390×470 canvas. Rather than a fixed
  // 390px box that floats in dead space on a 430pt phone and overflows a
  // 360pt one, the outer box takes the viewport width and the canvas scales
  // to fill it — proportionally identical on every phone, outer phones
  // bleeding off the screen edges exactly as designed. DESKTOP keeps its
  // fixed 660×640 stage (scale 1).
  //
  // The scale is a NUMBER, so it is measured in JS: CSS can't derive a
  // unitless ratio from `100vw / 390px` (length ÷ length is not allowed in
  // calc for scale()). ResizeObserver keeps it right on rotation.
  const outerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => {
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches
      setDesktop(isDesktop)
      setScale(isDesktop ? 1 : el.clientWidth / CLUSTER_W)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={outerRef}
      className="relative mx-auto w-full shrink-0 lg:h-[640px] lg:w-[660px]"
      // Mobile ALWAYS sets the height (the canvas is absolutely positioned, so
      // the box has no intrinsic height) — including at exactly scale 1 on a
      // 390pt phone, which used to collapse to 0.
      style={{ height: desktop ? undefined : CLUSTER_H * scale }}
      data-cluster
    >
    {/* Scaling lives on THIS wrapper, not on Parallax's element — Parallax
        writes `transform` inline for its scroll drift, and two writers on one
        element means one silently loses (see the note on Reveal/Parallax). */}
    <div
      className="absolute left-0 top-0 h-[470px] w-[390px] origin-top-left lg:static lg:h-auto lg:w-auto"
      style={{ transform: desktop ? undefined : `scale(${scale})` }}
    >
    {/* Centre the GROUP, not the front phone. The Figma canvas authors the
        cluster asymmetrically — measured with rotation, the three phones
        span −43 → 395 on the 390 canvas, so their visual centre sits 19px
        left of the canvas centre and the composition reads as leaning left
        (founder, 2026-08-17). One translate on the group shifts all three
        together, keeping sizes, overlap and depth exactly as designed, and
        the bleed becomes symmetric (~24px off each screen edge). Mobile only:
        the desktop stage is 660 wide and the phones sit inside it. */}
    <div className="h-full w-full translate-x-[19px] lg:translate-x-0">
    <Parallax className="relative h-[470px] w-[390px] lg:h-[640px] lg:w-[660px]">
      {/* Left — Community */}
      <div className="absolute left-[-24px] top-[46px] -rotate-6 lg:left-[47px] lg:top-[78px]">
        <Phone
          src="/landing/phone-community.png"
          alt="Hockia community screen: players, coaches and clubs around the world"
          className="relative h-[366px] w-[172px] shadow-[0_2px_4px_rgba(41,28,66,0.1),0_15px_17px_rgba(41,28,66,0.18)] lg:h-[502px] lg:w-[236px]"
          screenW={390}
          screenH={844}
        />
      </div>
      {/* Right — Feed. Top-anchored so the HOCKIA header and Feed/Pulse tabs
          stay visible whatever sliver object-cover trims. */}
      <div className="absolute left-[204px] top-[52px] rotate-6 lg:left-[381px] lg:top-[83px]">
        <Phone
          src="/landing/phone-feed.jpg"
          alt="Hockia home feed: opportunities, milestones and community activity"
          className="relative h-[366px] w-[172px] shadow-[0_2px_4px_rgba(41,28,66,0.1),0_15px_17px_rgba(41,28,66,0.18)] lg:h-[502px] lg:w-[236px]"
          imgClassName="object-top"
          screenW={590}
          screenH={1280}
        />
      </div>
      {/* Front — First run */}
      <div className="absolute left-[97px] top-[16px] lg:left-[186px] lg:top-[4px]">
        <Phone
          src="/landing/phone-firstrun.webp"
          alt="Hockia app: your game, your network"
          className="relative h-[417px] w-[196px] shadow-[0_4px_5px_rgba(41,28,66,0.12),0_22px_24px_rgba(41,28,66,0.24)] lg:h-[600px] lg:w-[282px]"
          imgClassName="object-top"
          priority
          screenW={780}
          screenH={1688}
        />
      </div>
    </Parallax>
    </div>
    </div>
    </div>
  )
}

/* ─────────────────────── Role panel ─────────────────────── */

interface RoleContent {
  key: string
  tab: string
  title: string
  titleAccent: string
  body: string
  chips: string[]
}

/** Player copy is verbatim from the Figma frame; the other four follow the
 *  per-role value props (memory: project_hockia_role_value_props). */
const ROLE_PANEL: RoleContent[] = [
  {
    key: 'player', tab: 'Player',
    title: 'Build your hockey profile.', titleAccent: 'Get discovered.',
    body: 'Career history, position, highlights and evidence. A professional identity made for hockey.',
    chips: ['Professional profile', 'Position identity', 'Open to play'],
  },
  {
    key: 'coach', tab: 'Coach',
    title: 'Show your coaching journey.', titleAccent: 'Get hired.',
    body: 'Specialisations, categories and career history — visible to clubs that need exactly you.',
    chips: ['Coaching profile', 'Specialisations', 'Open to coach'],
  },
  {
    key: 'club', tab: 'Club',
    title: 'Present your club.', titleAccent: 'Recruit with context.',
    body: 'Publish real roles, review applicants with evidence, and reach the worldwide game.',
    chips: ['Club page', 'Open roles', 'Applicant review'],
  },
  {
    key: 'umpire', tab: 'Umpire',
    title: 'Be part of the game.', titleAccent: 'Beyond matchday.',
    body: 'Your umpiring identity and categories, visible across the whole hockey ecosystem.',
    chips: ['Umpire profile', 'Categories', 'Visibility'],
  },
  {
    key: 'brand', tab: 'Brand',
    title: 'Reach the hockey world.', titleAccent: 'Meaningfully.',
    body: 'Understand the community and find real ways to take part in the sport.',
    chips: ['Brand page', 'Products', 'Community reach'],
  },
]

function RolePanel() {
  const [active, setActive] = useState(0)
  const role = ROLE_PANEL[active]

  return (
    <section className="bg-white pb-12 pt-11 lg:pb-20 lg:pt-[72px]">
      <Reveal className="flex flex-col items-center gap-4 lg:gap-[26px]">
        {/* Tabs — mobile: scrollable pill row; desktop: segmented control */}
        <div
          role="tablist"
          aria-label="Who Hockia is for"
          className="flex w-full gap-2 overflow-x-auto px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:w-auto lg:gap-0 lg:overflow-visible lg:rounded-full lg:bg-[#f3f2f7] lg:p-1 lg:px-1"
        >
          {ROLE_PANEL.map((r, i) => {
            const selected = i === active
            return (
              <button
                key={r.key}
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(i)}
                className={[
                  'shrink-0 cursor-pointer rounded-full px-4 py-[9px] text-sm transition-colors lg:px-[26px] lg:py-[11px]',
                  selected
                    ? 'bg-[#7c3aed] font-semibold text-white lg:bg-white lg:text-[#5b21b6] lg:shadow-[0_1px_4px_rgba(41,28,66,0.1)]'
                    : 'border border-[#dad9e2] bg-white font-medium text-[#504f59] hover:text-[#2b2a33] lg:border-0 lg:bg-transparent',
                ].join(' ')}
              >
                {r.tab}
              </button>
            )
          })}
        </div>

        {/* Per-role copy — keyed so the swap re-fires the entrance */}
        <div key={role.key} className="flex animate-fadeSlideIn flex-col items-center gap-4 px-5 lg:gap-[26px]">
          <h2 className="text-center text-[28px] font-bold leading-[34px] tracking-[-0.025em] text-[#2b2a33] lg:text-[40px] lg:font-extrabold lg:leading-[46px] lg:tracking-[-0.035em]">
            {role.title}
            <span className="block text-[#5b21b6]">{role.titleAccent}</span>
          </h2>
          <p className="max-w-[322px] text-center text-[15px] leading-[21px] tracking-[-0.007em] text-[#504f59] lg:max-w-[560px] lg:text-[19px] lg:leading-[29px]">
            {role.body}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 lg:gap-2.5">
            {role.chips.map((c) => (
              <span key={c} className="rounded-full bg-[#f4f1ff] px-3 py-[7px] text-xs font-semibold tracking-[0.008em] text-[#5b21b6] lg:px-3.5 lg:py-2 lg:text-[13px]">
                {c}
              </span>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ─────────────────── Opportunities section ─────────────────── */

interface TeaserRole {
  title: string
  org: string
  country: string
  /** Raw position/opportunity slug, e.g. "goalkeeper" | "head_coach". */
  position: string
}

/** The three roles in the Figma frame — real prod listings at design time.
 *  Only ever shown if the live fetch fails; better a real-but-stale role
 *  than an empty section on the page whose argument is "this is live". */
const FALLBACK_ROLES: TeaserRole[] = [
  { title: 'Goalkeeper wanted', org: 'Quilmes Atletico Club', country: 'Argentina', position: 'goalkeeper' },
  { title: 'Head Coach wanted', org: 'KHCB', country: 'Spain', position: 'head_coach' },
  { title: 'Forward wanted', org: 'Puerto Belgrano HC', country: 'Argentina', position: 'forward' },
]

/** Position-chip palettes from the design (position/* tokens). Coach-type
 *  roles share the defender blue, per the Figma frame. */
const POS_CHIP: Record<string, { bg: string; text: string; label: string }> = {
  goalkeeper: { bg: '#ffefec', text: '#95141c', label: 'Goalkeeper' },
  defender: { bg: '#e7f6ff', text: '#005878', label: 'Defender' },
  midfielder: { bg: '#eefbf1', text: '#00612f', label: 'Midfielder' },
  forward: { bg: '#f4f1ff', text: '#5b21b6', label: 'Forward' },
}

function posChip(position: string) {
  const direct = POS_CHIP[position]
  if (direct) return direct
  // head_coach / assistant_coach / … — anything non-field reads as "Coach".
  return { bg: '#e7f6ff', text: '#005878', label: 'Coach' }
}

function OpportunitiesSection() {
  const [roles, setRoles] = useState<TeaserRole[]>(FALLBACK_ROLES)

  // Live open roles via the public API (same source as the developers page).
  // Failure keeps the fallback silently — never an empty section.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{
          data?: Array<{
            title?: string
            position?: string | null
            location?: { country?: string | null } | null
            club?: { name?: string | null } | null
          }>
        }>('public-opportunities?limit=3', { method: 'GET' })
        if (error) throw error
        const rows = (data?.data ?? [])
          .map((r) => ({
            title: r.title?.trim() ?? '',
            org: r.club?.name?.trim() ?? '',
            country: r.location?.country?.trim() ?? '',
            position: r.position ?? '',
          }))
          .filter((r) => r.title && r.org)
          .slice(0, 3)
        if (!cancelled && rows.length === 3) setRoles(rows)
      } catch (err) {
        logger.debug('[Landing] live roles unavailable, using fallback', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="bg-[#f9f9fb] px-5 pb-12 pt-11 lg:px-[72px] lg:pb-[88px] lg:pt-20">
      <Reveal className="mx-auto flex max-w-[1024px] flex-col items-center gap-4 lg:gap-9">
        <h2 className="text-center text-[28px] font-bold leading-[34px] tracking-[-0.025em] text-[#2b2a33] lg:text-[40px] lg:font-extrabold lg:leading-[46px] lg:tracking-[-0.035em]">
          Your next <span className="text-[#5b21b6]">opportunity</span>
          <span className="block">could be anywhere.</span>
        </h2>

        {/* Mobile: compact rows. Desktop: three cards. One list, two skins. */}
        <div className="flex w-full flex-col gap-4 lg:w-auto lg:flex-row lg:items-start lg:gap-5">
          {roles.map((r) => {
            const chip = posChip(r.position)
            return (
              <Link
                key={`${r.title}-${r.org}`}
                to="/opportunities"
                onClick={() => trackDbEvent('cta_click', undefined, undefined, { cta: 'open_role_teaser', location: 'opportunities_section' })}
                className="group flex items-center gap-3 rounded-2xl border border-[#dad9e2] bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-[#c9c6d6] hover:shadow-[0_10px_24px_-12px_rgba(41,28,66,0.25)] motion-reduce:transform-none lg:w-[300px] lg:flex-col lg:items-start lg:gap-3 lg:rounded-[18px] lg:p-[22px] lg:shadow-[0_1px_2px_rgba(41,28,66,0.05)]"
              >
                {/* Desktop-only "Open" pill riding with the pos chip */}
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="flex items-center gap-[5px] rounded-full bg-[#f0fdf5] py-1 pl-[9px] pr-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" aria-hidden="true" />
                    <span className="text-xs font-semibold tracking-[0.008em] text-[#00612f]">Open</span>
                  </span>
                  <span className="rounded-full px-[9px] py-1 text-xs font-semibold tracking-[0.008em]" style={{ backgroundColor: chip.bg, color: chip.text }}>
                    {chip.label}
                  </span>
                </div>

                {/* Mobile-only pos chip */}
                <span className="shrink-0 rounded-full px-[9px] py-[5px] text-xs font-semibold tracking-[0.008em] lg:hidden" style={{ backgroundColor: chip.bg, color: chip.text }}>
                  {chip.label}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-none lg:gap-3">
                  <span className="truncate text-base font-semibold tracking-[-0.01em] text-[#2b2a33] lg:whitespace-normal lg:text-[22px] lg:leading-7 lg:tracking-[-0.018em]">
                    {r.title}
                  </span>
                  <span className="truncate text-xs font-medium tracking-[0.008em] text-[#6e6779] lg:text-sm">
                    <span className="lg:text-[#504f59]">{r.org}</span> · {r.country}
                  </span>
                  <span className="hidden pt-1 text-[13px] font-semibold tracking-[-0.004em] text-[#5b21b6] lg:block">
                    Apply in the app
                  </span>
                </span>

                {/* Mobile-only open dot */}
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#16a34a] lg:hidden" aria-label="Open role" />
              </Link>
            )
          })}
        </div>

        <p className="text-center text-[13px] font-medium tracking-[-0.004em] text-[#6e6779] lg:text-[19px] lg:font-normal lg:leading-[29px] lg:tracking-[-0.008em] lg:text-[#504f59]">
          <span className="lg:hidden">Clubs publish real roles. Apply in the app.</span>
          <span className="hidden lg:inline">
            Players and coaches discover roles worldwide. Clubs discover people who are actually looking.
          </span>
        </p>
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
    <div className="min-h-screen bg-white" style={{ color: INK }}>
      <InAppBrowserWarning context="login" />
      <LandingNav onCta={handleCta} />

      {/* ───────────── S1 · Hero ───────────── */}
      <section className="mx-auto flex max-w-[1440px] flex-col items-center gap-[18px] px-5 pb-2 pt-9 lg:flex-row lg:items-center lg:gap-12 lg:py-8 lg:pl-[72px] lg:pr-12">
        {/* w-full + min-w-0: the column spans the section's content width
            (viewport − 2×px-5) and can never be widened by a child. Without
            it a 400px child made the column 400px on a 390pt phone and the
            CTAs overflowed the screen (negative gutters). */}
        <div className="flex w-full min-w-0 flex-col items-center gap-[18px] lg:flex-1 lg:items-start lg:gap-6">
          <Reveal>
            {/* Eyebrow — tagline signature "A · Orbit light" */}
            <span className="relative inline-flex items-center rounded-full border border-[#ede9ff] bg-white py-[7px] pl-3 pr-3.5 lg:py-2 lg:pl-3.5 lg:pr-4">
              <span className="text-xs font-semibold tracking-[0.008em] text-[#5b21b6] lg:text-[13px] lg:tracking-[-0.004em]">
                Where field hockey sticks together
              </span>
              <span className="orbit-ring" aria-hidden="true" />
            </span>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="text-center text-[38px] font-extrabold leading-[42px] tracking-[-0.04em] lg:text-left lg:text-[64px] lg:leading-[68px]" style={{ color: INK }}>
              The network for
              <span className="block" style={{ color: BRAND_TEXT }}>field hockey.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="max-w-[320px] text-center text-base leading-6 tracking-[-0.009em] lg:max-w-[430px] lg:text-left lg:text-[19px] lg:leading-[29px]" style={{ color: INK_2 }}>
              One network for the whole game: build your hockey identity, connect worldwide, and find your next move.
            </p>
          </Reveal>

          {/* Ecosystem chips — scrollable strip on mobile, inline on desktop */}
          {/* -mx-5 + calc width lets the strip scroll edge-to-edge while its box
              stays the column's width. The previous `w-screen` inflated the
              flex column to the viewport, so the CTA block below (w-full)
              rendered 440px wide on a 440px screen — zero gutter. */}
          <Reveal delay={170} className="-mx-5 w-[calc(100%+40px)] lg:mx-0 lg:w-auto">
            <div className="flex gap-2 overflow-x-auto px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible lg:px-0">
              {['Players', 'Coaches', 'Clubs', 'Umpires', 'Brands'].map((c) => (
                <span key={c} className="shrink-0 rounded-full border border-[#e4e3eb] bg-[#f9f9fb] px-[13px] py-2 text-[13px] font-medium tracking-[-0.004em] lg:px-3 lg:py-[7px]" style={{ color: INK_2 }}>
                  {c}
                </span>
              ))}
            </div>
          </Reveal>

          {/* Same width for both, always: they fill the column (viewport − 2×20px
              gutters, the design's px-5), capped at 400px so on a tablet-width
              phone they stay a CTA and not a bar. Desktop is a side-by-side row. */}
          <Reveal delay={220} className="w-full max-w-[400px] lg:w-auto lg:max-w-none">
            <div className="flex w-full flex-col gap-3.5 lg:w-auto lg:flex-row lg:items-center lg:gap-3">
              <Link
                to="/signup"
                onClick={() => handleCta('create_profile', 'hero')}
                className="flex h-[54px] w-full items-center justify-center rounded-[14px] bg-[#7c3aed] text-[17px] font-semibold tracking-[-0.012em] text-white shadow-[0_6px_18px_rgba(124,58,237,0.32)] transition-all hover:-translate-y-0.5 hover:bg-[#6d28d9] active:translate-y-0 active:scale-[0.985] motion-reduce:transform-none lg:w-auto lg:px-[26px]"
              >
                Create a profile
              </Link>
              <Link
                to={EXPLORE_PATH}
                onClick={() => handleCta('explore_hockia', 'hero')}
                className="group flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[#dad9e2] bg-white text-[17px] font-semibold tracking-[-0.012em] transition-all hover:-translate-y-0.5 hover:border-[#c9c6d6] hover:bg-gray-50 active:translate-y-0 active:scale-[0.985] motion-reduce:transform-none lg:w-auto lg:pl-6 lg:pr-5"
                style={{ color: INK }}
              >
                Explore Hockia
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" style={{ color: INK_3 }} />
              </Link>
            </div>
          </Reveal>

          <Reveal delay={260}>
            <p className="text-[13px] font-medium tracking-[-0.004em]" style={{ color: INK_3 }}>
              No account needed to look around
            </p>
          </Reveal>

          {/* Store links are pointless (and Apple-frowned-upon) inside the app */}
          {!isNativeApp && (
            <Reveal delay={300}>
              <div className="flex items-center gap-2.5 lg:gap-3">
                <p className="text-[13px] font-medium tracking-[-0.004em]" style={{ color: INK_3 }}>
                  Or get the app
                </p>
                <StoreBadges heightClass="h-10 lg:h-11" source="landing_hero" />
              </div>
            </Reveal>
          )}
        </div>

        {/* The cluster BLEEDS to the screen edges on mobile — the Figma frame
            runs the outer phones off both sides on purpose. `w-screen` +
            negative margins escape the section's px-5, so the only thing
            that clips a phone is the viewport itself, never an inner padding
            box (which chopped 37px off the left phone at 430w). Desktop keeps
            its own width; the hero's flex row positions it. */}
        <Reveal delay={150} className="-mx-5 w-screen overflow-hidden lg:mx-0 lg:w-auto lg:overflow-visible">
          <PhoneCluster />
        </Reveal>
      </section>

      {/* ───────────── S2 · Live proof ───────────── */}
      <section className="bg-[#faf8ff] px-5 pb-11 pt-10 lg:px-[72px] lg:py-14">
        <LandingStats variant="band" />
      </section>

      {/* ───────────── S3 · Role panel ───────────── */}
      <RolePanel />

      {/* ───────────── S4 · Opportunities ───────────── */}
      <OpportunitiesSection />

      {/* ───────────── S5 · Final CTA ───────────── */}
      <section className="relative overflow-hidden px-6 pb-[60px] pt-[52px] lg:px-[72px] lg:pb-[104px] lg:pt-24" style={{ backgroundColor: BRAND_SOLID }}>
        {/* Watermark — the mark itself, oversized and quiet (Figma 23:489) */}
        <img
          src="/brand/svg/hockia-logo-white.svg"
          alt=""
          aria-hidden="true"
          width={300}
          height={243}
          loading="lazy"
          className="pointer-events-none absolute -top-8 left-[46%] h-[320px] w-auto max-w-none opacity-[0.13] lg:-top-20 lg:left-[70%] lg:h-[560px]"
        />

        <Reveal className="relative flex flex-col items-center gap-[18px] lg:gap-7">
          <h2 className="text-center text-[34px] font-extrabold leading-[37px] tracking-[-0.034em] text-white lg:text-[64px] lg:leading-[68px] lg:tracking-[-0.04em]">
            The field hockey world.
            <span className="block">One community.</span>
          </h2>

          {/* Mobile leads with the account CTA; desktop leads with the apps
              (per the two Figma frames) */}
          <Link
            to="/signup"
            onClick={() => handleCta('create_profile', 'closing_cta')}
            className="flex h-[54px] w-full items-center justify-center rounded-[14px] bg-white text-[17px] font-semibold tracking-[-0.012em] text-[#5b21b6] transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985] motion-reduce:transform-none lg:hidden"
          >
            Create a profile
          </Link>

          {!isNativeApp && <StoreBadges heightClass="h-[42px] lg:h-[52px]" source="landing_footer" />}

          <p className="hidden text-[13px] font-medium tracking-[-0.004em] text-white/75 lg:block">
            Free for players and coaches · hockia.com
          </p>
          <p className="text-sm text-white lg:hidden">
            <span className="font-medium opacity-70">Already a member?</span>{' '}
            <Link to="/signin" className="font-semibold underline underline-offset-2">
              Log in
            </Link>
          </p>

          <HockiaSocials tone="onBrand" iconClassName="h-[21px] w-[21px]" />

          <p className="text-sm text-white">
            <span className="font-medium opacity-70">Questions?</span>{' '}
            <button type="button" onClick={openContact} className="font-semibold underline underline-offset-2">
              Team@inhockia.com
            </button>
          </p>
        </Reveal>
      </section>
    </div>
  )
}
