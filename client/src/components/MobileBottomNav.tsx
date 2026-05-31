import { useEffect, useState } from 'react'
import { Home, Users, Briefcase, Globe, Sparkles } from 'lucide-react'
import Avatar from './Avatar'
import { NotificationBadge } from '@/components'
import { useNavigation } from '@/hooks/useNavigation'

interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ComponentType<{ className?: string }>
}

export default function MobileBottomNav() {
  const {
    user,
    profile,
    location,
    isActive,
    handleNavigate,
    opportunityCount,
  } = useNavigation()
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  // The floating Hockia AI button hides while the user scrolls DOWN through
  // content (so it never obscures what they're reading — e.g. a card's fit
  // chip or gallery text) and reappears on scroll-up, near the top, or once
  // scrolling stops. The bottom nav itself stays put; only the FAB reacts.
  const [fabHidden, setFabHidden] = useState(false)

  // rAF-coalesced scroll listener — compares scrollY frame-to-frame to derive
  // direction. Hide on downward scroll past a small threshold; show on any
  // upward scroll or when within 80px of the top. A short idle timer also
  // re-reveals it so it never stays hidden once the user pauses.
  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const update = () => {
      ticking = false
      const y = window.scrollY
      const delta = y - lastY
      if (y < 80) {
        setFabHidden(false)
      } else if (delta > 6) {
        setFabHidden(true)
      } else if (delta < -6) {
        setFabHidden(false)
      }
      lastY = y
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => setFabHidden(false), 1200)
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (idleTimer) clearTimeout(idleTimer)
    }
  }, [])

  // Navigation items
  const navItems: NavItem[] = [
    {
      id: 'home',
      label: 'Home',
      path: '/home',
      icon: Home,
    },
    {
      id: 'world',
      label: 'World',
      path: '/world',
      icon: Globe,
    },
    {
      id: 'opportunities',
      label: 'Opportunities',
      path: '/opportunities',
      icon: Briefcase,
    },
    {
      id: 'community',
      label: 'Community',
      path: '/community',
      icon: Users,
    },
  ]

  // Handle keyboard visibility (iOS specific)
  useEffect(() => {
    const handleResize = () => {
      // Detect keyboard on mobile by checking if viewport height decreased significantly
      if (typeof window !== 'undefined' && window.visualViewport) {
        const viewportHeight = window.visualViewport.height
        const windowHeight = window.innerHeight
        const heightDiff = windowHeight - viewportHeight
        
        // If height difference is significant (> 150px), keyboard is likely open
        setIsKeyboardOpen(heightDiff > 150)
      }
    }

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
      return () => window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [])

  // Hide on certain routes (modals, auth pages)
  useEffect(() => {
    const hiddenRoutes = ['/', '/signup', '/login', '/complete-profile', '/discover']
    const searchParams = new URLSearchParams(location.search)
    const isConversationPath = location.pathname.startsWith('/messages/')
    const hasMessagesOverlayParam = searchParams.has('conversation') || searchParams.has('new')
    const isImmersiveMessagesView =
      location.pathname.startsWith('/messages') &&
      (isConversationPath || hasMessagesOverlayParam)
    const shouldHide =
      hiddenRoutes.some(route => location.pathname === route) ||
      isImmersiveMessagesView
    setIsHidden(shouldHide)
  }, [location.pathname, location.search])

  // Don't render if user is not authenticated or on hidden routes
  if (!user || !profile || isHidden) {
    return null
  }

  // Hide when keyboard is open
  if (isKeyboardOpen) {
    return null
  }

  return (
    <>
      {/* Spacer to prevent content from being hidden behind fixed nav */}
      <div className="h-20 lg:hidden" aria-hidden="true" />

      {/* Bottom Navigation */}
      <nav 
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-gray-200/50 shadow-lg pb-[max(env(safe-area-inset-bottom),0.5rem)] [transform:translate3d(0,0,0)]"
      >
        <div className="flex items-center justify-between px-2 pt-2 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.path)
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.path)}
                className={`flex flex-col items-center justify-center min-w-[48px] min-h-[44px] py-1 px-2 rounded-xl transition-all duration-200 ${
                  active 
                    ? 'text-[#8026FA]' 
                    : 'text-gray-600 active:bg-gray-100'
                }`}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <div className={`relative flex items-center justify-center w-7 h-7 mb-0.5 transition-transform duration-200 ${
                  active ? 'scale-110' : 'scale-100'
                }`}>
                  <Icon 
                    className={`w-6 h-6 transition-all duration-200 ${
                      active ? 'stroke-[2.5]' : 'stroke-[2]'
                    }`}
                  />
                  {item.id === 'opportunities' && (
                    <NotificationBadge count={opportunityCount} />
                  )}
                  {active && (
                    <div className="absolute inset-0 bg-gradient-to-r from-[#8026FA] to-[#924CEC] opacity-20 rounded-full blur-md" />
                  )}
                </div>
                {/* Labels hidden below 360px (iPhone SE 1st-gen and narrower)
                    where 5 items × 10px-font would crowd into each other —
                    "Opportunities" alone is ~78px wide which doesn't fit a
                    60px slot. aria-label on the parent button (line 121)
                    keeps the nav fully accessible to screen readers. */}
                <span
                  className={`hidden min-[360px]:inline text-[10px] font-medium transition-all duration-200 ${
                    active ? 'opacity-100' : 'opacity-60'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            )
          })}

          {/* Dashboard slot — relative wrapper anchors the floating HOCKIA AI
              button so it stays vertically centred over the avatar regardless
              of viewport width. AI is intentionally NOT a sixth nav item:
              it's an intelligent shortcut that links into the Discover chat
              experience and sits visually above the Dashboard area, not in
              line with the primary nav. Inherits visibility from the parent
              nav, so it hides whenever the bottom nav hides (incl. /discover). */}
          <div className="relative">
            {/* Floating HOCKIA AI button — solid purple gradient with
                white icon. Matches the DiscoverPage's own Hockia AI
                header chip + empty-state badge styling so the surface
                stays visually consistent end-to-end. Stronger shadow
                + ring keeps it readable against the white nav bar. */}
            <button
              type="button"
              onClick={() => handleNavigate('/discover')}
              aria-label="Open Hockia AI"
              aria-hidden={fabHidden || undefined}
              tabIndex={fabHidden ? -1 : 0}
              className={`absolute bottom-full left-1/2 mb-4
                         w-12 h-12 rounded-full
                         bg-gradient-to-br from-[#8026FA] to-[#924CEC]
                         flex items-center justify-center
                         shadow-lg shadow-[#8026FA]/40 ring-2 ring-white
                         transition-all duration-300 ease-out
                         ${fabHidden
                           ? '-translate-x-1/2 translate-y-24 opacity-0 pointer-events-none'
                           : '-translate-x-1/2 translate-y-0 opacity-100 active:scale-95'}`}
            >
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.25} />
            </button>

            {/* Avatar = Dashboard nav item. Tap navigates directly to
                /dashboard/profile (mock convention). Settings + Sign out
                used to live in a dropdown anchored here; those moved to
                the SettingsSheet (gear icon) in the header so the avatar
                becomes a single-purpose nav tap. Purple ring on the avatar
                + label opacity bump mark the active state when on the
                dashboard. */}
            <button
              type="button"
              onClick={() => handleNavigate('/dashboard/profile')}
              aria-label="Dashboard"
              aria-current={location.pathname.startsWith('/dashboard') ? 'page' : undefined}
              className={`flex flex-col items-center justify-center min-w-[48px] min-h-[44px] py-1 px-2 rounded-xl transition-all duration-200 ${
                location.pathname.startsWith('/dashboard')
                  ? 'text-[#8026FA]'
                  : 'text-gray-600 active:bg-gray-100'
              }`}
            >
              <div
                className={`relative flex items-center justify-center w-7 h-7 mb-0.5 transition-transform duration-200 ${
                  location.pathname.startsWith('/dashboard') ? 'scale-110' : 'scale-100'
                }`}
              >
                <Avatar
                  src={profile?.avatar_url}
                  initials={
                    (profile?.full_name ?? '')
                      .trim()
                      .split(' ')
                      .filter(Boolean)
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase() || '?'
                  }
                  size="sm"
                  loading="eager"
                  role={profile?.role}
                  // Match the 24px icon box of sibling nav items so the
                  // Dashboard slot is the same height (was ~4px taller).
                  className={`!w-6 !h-6 ${
                    location.pathname.startsWith('/dashboard')
                      ? 'ring-2 ring-[#8026FA] ring-offset-2'
                      : ''
                  }`}
                />
              </div>
              {/* Label matches sibling nav items — hidden under 360px to
                  match MobileBottomNav's existing icon-only fallback. */}
              <span
                className={`hidden min-[360px]:inline text-[10px] font-medium transition-all duration-200 ${
                  location.pathname.startsWith('/dashboard') ? 'opacity-100' : 'opacity-60'
                }`}
              >
                Dashboard
              </span>
            </button>
          </div>
        </div>
      </nav>
    </>
  )
}
