import { useEffect, useRef, useState } from 'react'
import { Users, Briefcase, Bell, Search, SquarePlus } from 'lucide-react'
import { AvatarMenu } from '@/components'
import { useNavigation } from '@/hooks/useNavigation'
import { useAuthStore } from '@/lib/auth'
import { useInboxSegmentDots } from '@/hooks/useInboxSegmentDots'
import { inboxTabDot } from '@/lib/inboxSegmentDots'
import { HockiaAiButton } from '@/components/hockiaAi/HockiaAiButton'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'

/** Unread indicator — a red dot, never a number (founder rule: no counts), the
 *  same dot and the same rules as the phone tab bar (MobileBottomNav). */
function NavDot({ className }: { className: string }) {
  return <span aria-label="Unread" data-testid="header-unread-dot" className={`absolute h-2 w-2 rounded-full bg-brand-primary ring-2 ring-white ${className}`} />
}

/** `mobileHidden`: screens that carry their own title row (the Profile
 *  screen, founder ruling 2026-09-19) drop the app header below lg.
 *  `onNewPost`: Home v1 (Figma 60:131) — "+" New post and Search on phones. */
/**
 * Home v1 motion (95:1012 §1): on phones the header slides away when the page
 * scrolls down > 8 pt and returns on any scroll up > 4 pt; always shown within
 * 48 pt of the top. Transform only, one passive listener, rAF-throttled.
 * Reduce Motion: the header stays put.
 */
function useHideOnScroll(enabled: boolean) {
  const [hidden, setHidden] = useState(false)
  const [edge, setEdge] = useState(0)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let last = window.scrollY
    let anchor = last // where the current scroll direction started
    let dir = 0
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const y = Math.max(0, window.scrollY)
        setEdge(Math.min(1, y / 24))
        const d = Math.sign(y - last)
        if (d !== 0 && d !== dir) { dir = d; anchor = last }
        if (y <= 48) setHidden(false)
        else if (dir > 0 && y - anchor > 8) setHidden(true)
        else if (dir < 0 && anchor - y > 4) setHidden(false)
        last = y
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [enabled])
  return { hidden: enabled && hidden, edge: enabled ? edge : 0 }
}

export default function Header({ mobileHidden = false, onNewPost, hideOnScroll = false }: { mobileHidden?: boolean; onNewPost?: () => void; hideOnScroll?: boolean } = {}) {
  const { hidden, edge } = useHideOnScroll(hideOnScroll)
  const {
    user,
    profile,
    isActive,
    handleNavigate,
    toggleNotificationDrawer,
  } = useNavigation()
  // Same dots as the phone: Inbox = any Inbox segment has something new;
  // the bell = the Activity segment's dot. Opportunities carries none.
  const segmentDots = useInboxSegmentDots()
  const inboxDot = inboxTabDot(segmentDots)
  const showHockiaAi = useHockiaAiSheet((s) => s.show)
  const openHockiaAi = () => showHockiaAi('header')
  const authLoading = useAuthStore((s) => s.loading)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !headerRef.current) {
      return
    }

    const updateHeaderMetrics = () => {
      if (!headerRef.current) {
        return
      }

      const root = document.documentElement
      // offsetHeight already includes the header's own safe-area padding
      // (pt-[env(safe-area-inset-top)]), so it IS the offset content needs.
      // (It used to add --app-safe-area-top on top, which is an unresolved
      // env() string here — the sum was either NaN or a double inset.)
      const headerHeight = headerRef.current.offsetHeight

      root.style.setProperty('--app-header-height', `${headerHeight}px`)
      root.style.setProperty('--app-header-offset', `${headerHeight}px`)
    }

    updateHeaderMetrics()

    let observer: ResizeObserver | null = null

    if ('ResizeObserver' in window) {
      observer = new ResizeObserver(() => updateHeaderMetrics())
      observer.observe(headerRef.current)
    }

    window.addEventListener('resize', updateHeaderMetrics)
    window.addEventListener('orientationchange', updateHeaderMetrics)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeaderMetrics)
      window.removeEventListener('orientationchange', updateHeaderMetrics)
    }
  }, [])

  // GPU-promote the fixed header (translate3d + backface-visibility) so
  // iOS/WKWebView doesn't tear or flicker it during momentum scroll — the
  // bottom nav already does this; the header was the missing half.
  return (
    <>
    {hideOnScroll && (
      // Scroll edge under the status bar: blur 20 + surface 80 %, fading in over the first 24 pt.
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[49] h-[env(safe-area-inset-top)] bg-white/80 backdrop-blur-[20px] lg:hidden"
        style={{ opacity: edge }}
      />
    )}
    <header
      ref={headerRef}
      className={`${mobileHidden ? 'hidden lg:block ' : ''}fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 pt-[env(safe-area-inset-top)] [backface-visibility:hidden] transition-transform duration-[250ms] ease-[cubic-bezier(.2,0,0,1)] lg:!transform-none`}
      style={{ transform: hidden ? 'translate3d(0, -100%, 0)' : 'translate3d(0, 0, 0)' }}
    >
      <nav className="max-w-7xl mx-auto px-4 md:px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleNavigate(user ? '/home' : '/')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-[44px]"
              aria-label="Hockia, go home"
            >
              {/* Phone: the ink wordmark only (the tab bar already says where
                  you are). Web (rebrand page 16): the horizontal ink lockup,
                  26 high; the wordmark never appears alone on the web. */}
              <img
                src="/brand/wordmark/hockia-wordmark-black.svg"
                alt=""
                className="h-8 lg:hidden"
              />
              <img
                src="/brand/lockup/hockia-lockup-horizontal-ink.svg"
                alt=""
                width={126}
                height={26}
                className="hidden h-[26px] w-auto lg:block"
              />
            </button>
            
          </div>

          {/* Mobile header (Figma 03 Player, Home v2): wordmark + Search only.
              Notifications and messages moved into the Inbox tab; settings
              live on the Profile screen. */}
          {user && profile && (
            <div className="flex lg:hidden items-center">
              {/* Hockia AI: the mascot beside Search, for every role (founder
                  2026-10-22); opens the one Hockia AI sheet over this screen. */}
              <HockiaAiButton onClick={openHockiaAi} testId="header-hockia-ai" />
              {onNewPost && (
                <button
                  type="button"
                  onClick={onNewPost}
                  className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-gray-900 hover:bg-gray-100 transition-colors"
                  aria-label="New post"
                  data-testid="header-new-post"
                >
                  <SquarePlus className="w-6 h-6" strokeWidth={1.8} />
                </button>
              )}
              {/* Search v2 (founder rulings 2026-10-03): the icon opens the
                  /search screen on every page, not only where the Home
                  overlay happens to be mounted. */}
              <button
                onClick={() => handleNavigate('/search')}
                className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-gray-900 hover:bg-gray-100 transition-colors"
                aria-label="Search"
              >
                <Search className="w-[22px] h-[22px]" strokeWidth={1.75} />
              </button>
            </div>
          )}

          {/* Mobile, GUEST — returning visitors look for "Log in" in the
              header, so it belongs here rather than in the bottom bar, which
              carries the three explore areas plus Join. Mirrors the landing
              page's mobile nav pill so the two surfaces read as one product. */}
          {!user && !authLoading && (
            <div className="flex lg:hidden items-center">
              <button
                onClick={() => handleNavigate('/signin')}
                className="min-h-[44px] rounded-full bg-[#f4f1ff] px-4 text-sm font-semibold text-[#5b21b6] transition-colors active:bg-[#ede9ff]"
              >
                Log in
              </button>
            </div>
          )}

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {user && profile ? (
              <>
                {/* Primary nav (rebrand page 16): text only; active = ink on a
                    soft violet pill. */}
                {([
                  { path: '/home', label: 'Home', dot: false },
                  { path: '/community', label: 'Community', dot: false },
                  { path: '/opportunities', label: 'Opportunities', dot: false },
                  // Web only (founder 2026-10-26, page 16); phones reach it from Community.
                  { path: '/community/brands', label: 'Marketplace', dot: false },
                  { path: '/inbox', label: 'Inbox', dot: inboxDot },
                ]).map(({ path, label, dot }) => {
                  // Marketplace = Community › Brands, so Community is not lit there.
                  const onBrands = isActive('/community/brands')
                  const active = path === '/community/brands' ? onBrands
                    : path === '/community' ? isActive(path) && !onBrands
                    : isActive(path) || (path === '/inbox' && isActive('/messages'))
                  return (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`relative rounded-full px-3.5 py-2 text-[15px] font-medium transition-colors ${
                      active
                        ? 'bg-hockia-soft text-ink-1'
                        : 'text-ink-2 hover:bg-surface-muted hover:text-ink-1'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {label}
                    {dot && <NavDot className="right-1 top-1" />}
                  </button>
                  )
                })}

                {/* Search pill (rebrand page 16): opens /search. */}
                <button
                  type="button"
                  onClick={() => handleNavigate('/search')}
                  className="ml-3 flex h-10 w-[150px] items-center gap-2 rounded-full bg-surface-muted px-4 text-left text-[14px] text-ink-2 transition-colors hover:bg-surface-muted-pressed xl:w-[310px]"
                  data-testid="header-search-desktop"
                >
                  <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">Search<span className="hidden xl:inline"> players, clubs, opportunities</span></span>
                </button>

                {/* Hockia AI + Notifications. Marketplace is a text link in the
                    nav above (web only); its content is the Community › Brands
                    hub (founder 2026-10-25, "by need and place"). */}
                {/* Ask Hockia AI pill (rebrand page 16): the one cyan element in
                    the header, always with the mascot (cyan never alone). */}
                <button
                  type="button"
                  onClick={openHockiaAi}
                  className="ml-2 flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-ai-accent/60 bg-ai-bg pl-1 pr-3.5 text-[14px] font-semibold text-ai-text transition-colors hover:border-ai-accent"
                  data-testid="header-hockia-ai-desktop"
                >
                  <img src="/hockia-ai/button_calm_96.webp" srcSet="/hockia-ai/button_calm_96.webp 1x, /hockia-ai/button_calm_192.webp 2x" alt="" width={32} height={32} className="h-8 w-8 rounded-full" draggable={false} />
                  Ask Hockia AI
                </button>
                <button
                  onClick={() => toggleNotificationDrawer()}
                  className="relative p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                  aria-label="Notifications"
                  title="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  {segmentDots.activity && <NavDot className="right-1.5 top-1.5" />}
                </button>

                {/* Avatar dropdown — Settings + Sign out moved off the
                    hamburger so users discover them in the conventional
                    place. Click the avatar opens a menu with Dashboard,
                    Settings, Sign out. */}
                <AvatarMenu isOnDashboard={isActive('/dashboard')} className="ml-1" />
              </>
            ) : (
              <>
                {/* Unauthenticated primary nav links */}
                {([
                  { path: '/opportunities', label: 'Opportunities', icon: Briefcase },
                  { path: '/community', label: 'Community', icon: Users },
                ]).map(({ path, label, icon: Icon }) => (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(path)
                        ? 'text-hockia-primary bg-hockia-primary/10'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    aria-current={isActive(path) ? 'page' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4.5 h-4.5" />
                      <span>{label}</span>
                    </div>
                  </button>
                ))}

                {/* Search pill (rebrand page 16): opens /search. */}
                <button
                  type="button"
                  onClick={() => handleNavigate('/search')}
                  className="ml-3 flex h-10 w-[150px] items-center gap-2 rounded-full bg-surface-muted px-4 text-left text-[14px] text-ink-2 transition-colors hover:bg-surface-muted-pressed xl:w-[310px]"
                  data-testid="header-search-desktop"
                >
                  <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">Search<span className="hidden xl:inline"> players, clubs, opportunities</span></span>
                </button>

                <button
                  onClick={() => handleNavigate('/')}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-3 py-2"
                >
                  Sign In
                </button>
                <button
                  onClick={() => handleNavigate('/signup')}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Join Hockia
                </button>
              </>
            )}
          </div>

        </div>

        {/* Mobile Menu - Hidden, navigation handled by MobileBottomNav */}
      </nav>
    </header>
    </>
  )
}
