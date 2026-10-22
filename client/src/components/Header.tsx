import { useEffect, useRef, useState } from 'react'
import { Home, Users, Briefcase, Bell, Inbox, Sparkles, Store, Search, SquarePlus } from 'lucide-react'
import { AvatarMenu } from '@/components'
import { useNavigation } from '@/hooks/useNavigation'
import { useAuthStore } from '@/lib/auth'
import { useInboxSegmentDots } from '@/hooks/useInboxSegmentDots'
import { inboxTabDot } from '@/lib/inboxSegmentDots'

/** Unread indicator — a red dot, never a number (founder rule: no counts), the
 *  same dot and the same rules as the phone tab bar (MobileBottomNav). */
function NavDot({ className }: { className: string }) {
  return <span aria-label="Unread" data-testid="header-unread-dot" className={`absolute h-2 w-2 rounded-full bg-hockia-danger ring-2 ring-white ${className}`} />
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
              aria-label="HOCKIA, go home"
            >
              {/* One wordmark colour on every app page: brand violet (design
                  audit B5). The tagline pill is marketing only, not app chrome. */}
              <img
                src="/brand/wordmark/hockia-wordmark-violet.svg"
                alt=""
                className="h-8"
              />
            </button>
            
          </div>

          {/* Mobile header (Figma 03 Player, Home v2): wordmark + Search only.
              Notifications and messages moved into the Inbox tab; settings
              live on the Profile screen. */}
          {user && profile && (
            <div className="flex lg:hidden items-center">
              {/* Clubs get a direct Hockia AI entry (sparkles) beside Search —
                  the same /discover screen players reach from Search. */}
              {profile.role === 'club' && (
                <button
                  type="button"
                  onClick={() => handleNavigate('/discover')}
                  className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-hockia-primary hover:bg-gray-100 transition-colors"
                  aria-label="Hockia AI"
                  data-testid="header-hockia-ai"
                >
                  <Sparkles className="w-[22px] h-[22px]" strokeWidth={1.75} />
                </button>
              )}
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
                {/* Primary nav links */}
                {([
                  { path: '/home', label: 'Home', icon: Home, dot: false },
                  { path: '/community', label: 'Community', icon: Users, dot: false },
                  { path: '/opportunities', label: 'Opportunities', icon: Briefcase, dot: false },
                  { path: '/inbox', label: 'Inbox', icon: Inbox, dot: inboxDot },
                ]).map(({ path, label, icon: Icon, dot }) => (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      (isActive(path) || (path === '/inbox' && isActive('/messages')))
                        ? 'text-hockia-primary bg-hockia-primary/10'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    aria-current={(isActive(path) || (path === '/inbox' && isActive('/messages'))) ? 'page' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4.5 h-4.5" />
                      <span>{label}</span>
                    </div>
                    {dot && <NavDot className="right-1 top-1" />}
                  </button>
                ))}

                {/* Separator */}
                <div className="w-px h-6 bg-gray-200 mx-1" />

                {/* Icon-only cluster: Marketplace + Discover + Messages + Notifications.
                    Desktop keeps both Marketplace and AI access in the header
                    (mobile uses the floating AI button above Dashboard instead). */}
                <button
                  onClick={() => handleNavigate('/marketplace')}
                  className={`relative p-2 rounded-lg transition-colors ${
                    isActive('/marketplace')
                      ? 'text-hockia-primary bg-hockia-primary/10'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-label="Marketplace"
                  title="Marketplace"
                  aria-current={isActive('/marketplace') ? 'page' : undefined}
                >
                  <Store className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleNavigate('/discover')}
                  className={`relative p-2 rounded-lg transition-colors ${
                    isActive('/discover')
                      ? 'text-hockia-primary bg-hockia-primary/10'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-label="Hockia AI"
                  title="Hockia AI: ask anything about clubs, players, opportunities"
                  aria-current={isActive('/discover') ? 'page' : undefined}
                >
                  <Sparkles className="w-5 h-5" />
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
                  { path: '/marketplace', label: 'Marketplace', icon: Store },
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

                {/* Separator */}
                <div className="w-px h-6 bg-gray-200 mx-1" />

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
                  Join HOCKIA
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
