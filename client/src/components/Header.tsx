import { useEffect, useRef } from 'react'
import { MessageCircle, Home, Users, Briefcase, Bell, Globe, Sparkles } from 'lucide-react'
import { Avatar, NotificationBadge } from '@/components'
import { useNavigation } from '@/hooks/useNavigation'

export default function Header() {
  const {
    user,
    profile,
    isActive,
    handleNavigate,
    toggleNotificationDrawer,
    unreadCount,
    opportunityCount,
    notificationCount,
    profileInitials,
  } = useNavigation()
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
      const headerHeight = headerRef.current.offsetHeight
      const safeAreaTop = parseFloat(
        getComputedStyle(root).getPropertyValue('--app-safe-area-top') || '0'
      )

      root.style.setProperty('--app-header-height', `${headerHeight}px`)
      root.style.setProperty('--app-header-offset', `${headerHeight + safeAreaTop}px`)
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

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200"
    >
      <nav className="max-w-7xl mx-auto px-4 md:px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo & Tagline */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => handleNavigate(user ? '/home' : '/')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <img 
                src="/New-LogoBlack.svg" 
                alt="PLAYR" 
                className="h-8"
              />
            </button>
            
            <span className="hidden md:inline-block px-3 py-1 rounded-full text-xs font-medium text-white bg-[#ff9500]">
              The Home of Field Hockey.
            </span>
          </div>

          {/* Mobile Navigation - Discover + Messages + Notifications (rest in bottom nav) */}
          {user && profile && (
            <div className="flex md:hidden items-center gap-1">
              <button
                onClick={() => handleNavigate('/discover')}
                className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  isActive('/discover')
                    ? 'text-[#8026FA] bg-[#8026FA]/10'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                aria-label="Discover"
              >
                <Sparkles className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleNavigate('/messages')}
                className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Messages"
              >
                <MessageCircle className="w-5 h-5" />
                <NotificationBadge count={unreadCount} className="-right-0.5 -top-0.5" />
              </button>
              <button
                onClick={() => toggleNotificationDrawer()}
                className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                <NotificationBadge count={notificationCount} className="-right-0.5 -top-0.5" />
              </button>
            </div>
          )}

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {user && profile ? (
              <>
                {/* Primary nav links */}
                {([
                  { path: '/home', label: 'Home', icon: Home, badge: undefined as number | undefined },
                  { path: '/world', label: 'World', icon: Globe, badge: undefined as number | undefined },
                  { path: '/opportunities', label: 'Opportunities', icon: Briefcase, badge: opportunityCount as number | undefined },
                  { path: '/community', label: 'Community', icon: Users, badge: undefined as number | undefined },
                ]).map(({ path, label, icon: Icon, badge }) => (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(path)
                        ? 'text-[#8026FA] bg-[#8026FA]/10'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    aria-current={isActive(path) ? 'page' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4.5 h-4.5" />
                      <span>{label}</span>
                    </div>
                    {badge !== undefined && <NotificationBadge count={badge} className="-right-1 -top-1" />}
                  </button>
                ))}

                {/* Separator */}
                <div className="w-px h-6 bg-gray-200 mx-1" />

                {/* Icon-only cluster: Discover + Messages + Notifications */}
                <button
                  onClick={() => handleNavigate('/discover')}
                  className={`relative p-2 rounded-lg transition-colors ${
                    isActive('/discover')
                      ? 'text-[#8026FA] bg-[#8026FA]/10'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-label="Discover"
                  aria-current={isActive('/discover') ? 'page' : undefined}
                >
                  <Sparkles className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleNavigate('/messages')}
                  className={`relative p-2 rounded-lg transition-colors ${
                    isActive('/messages')
                      ? 'text-[#8026FA] bg-[#8026FA]/10'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-label="Messages"
                  aria-current={isActive('/messages') ? 'page' : undefined}
                >
                  <MessageCircle className="w-5 h-5" />
                  <NotificationBadge count={unreadCount} className="-right-0.5 -top-0.5" />
                </button>
                <button
                  onClick={() => toggleNotificationDrawer()}
                  className="relative p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  <NotificationBadge count={notificationCount} className="-right-0.5 -top-0.5" />
                </button>

                {/* Profile Avatar */}
                <button
                  onClick={() => handleNavigate('/dashboard/profile')}
                  className={`ml-1 flex items-center rounded-full transition-all ${
                    isActive('/dashboard')
                      ? 'ring-2 ring-[#8026FA] ring-offset-2'
                      : 'hover:opacity-80'
                  }`}
                  aria-label="Go to Dashboard"
                  aria-current={isActive('/dashboard') ? 'page' : undefined}
                >
                  <Avatar
                    src={profile.avatar_url}
                    initials={profileInitials}
                    size="sm"
                  />
                </button>
              </>
            ) : (
              <>
                {/* Unauthenticated primary nav links */}
                {([
                  { path: '/world', label: 'World', icon: Globe, badge: undefined as number | undefined },
                  { path: '/opportunities', label: 'Opportunities', icon: Briefcase, badge: opportunityCount as number | undefined },
                  { path: '/community', label: 'Community', icon: Users, badge: undefined as number | undefined },
                ]).map(({ path, label, icon: Icon, badge }) => (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(path)
                        ? 'text-[#8026FA] bg-[#8026FA]/10'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    aria-current={isActive(path) ? 'page' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4.5 h-4.5" />
                      <span>{label}</span>
                    </div>
                    {badge !== undefined && <NotificationBadge count={badge} className="-right-1 -top-1" />}
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
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Join PLAYR
                </button>
              </>
            )}
          </div>

        </div>

        {/* Mobile Menu - Hidden, navigation handled by MobileBottomNav */}
      </nav>
    </header>
  )
}
