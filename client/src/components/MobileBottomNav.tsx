import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Users, Briefcase, Globe } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { Avatar, NotificationBadge } from '@/components'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useNotificationStore } from '@/lib/notifications'

interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ComponentType<{ className?: string }>
}

export default function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, user } = useAuthStore()
  const { count: opportunityCount } = useOpportunityNotifications()
  const toggleNotificationDrawer = useNotificationStore((state) => state.toggleDrawer)
  const closeNotificationsDrawer = () => toggleNotificationDrawer(false)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const handleNavigate = (path: string) => {
    closeNotificationsDrawer()
    navigate(path)
  }

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

  // Check if path is active
  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

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

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <>
      {/* Spacer to prevent content from being hidden behind fixed nav */}
      <div className="h-20 md:hidden" aria-hidden="true" />

      {/* Bottom Navigation */}
      <nav 
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-gray-200/50 shadow-lg pb-[max(env(safe-area-inset-bottom),0.5rem)] [transform:translate3d(0,0,0)]"
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
                <span
                  className={`text-[10px] font-medium transition-all duration-200 ${
                    active ? 'opacity-100' : 'opacity-60'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            )
          })}

          {/* Profile Avatar - Direct Dashboard Navigation */}
          <button
            onClick={() => handleNavigate('/dashboard/profile')}
            className={`flex flex-col items-center justify-center min-w-[48px] min-h-[44px] py-1 px-2 rounded-xl transition-all duration-200 ${
              location.pathname.startsWith('/dashboard')
                ? 'text-[#8026FA]'
                : 'text-gray-600 active:bg-gray-100'
            }`}
            aria-label="Go to Dashboard"
          >
            <div className={`relative mb-0.5 transition-transform duration-200 ${
              location.pathname.startsWith('/dashboard') ? 'scale-110' : 'scale-100'
            }`}>
              <Avatar
                src={profile.avatar_url}
                initials={getInitials(profile.full_name)}
                size="sm"
                className={`transition-all duration-200 ${
                  location.pathname.startsWith('/dashboard')
                    ? 'ring-2 ring-[#8026FA] ring-offset-2'
                    : ''
                }`}
              />
              {location.pathname.startsWith('/dashboard') && (
                <div className="absolute inset-0 bg-gradient-to-r from-[#8026FA] to-[#924CEC] opacity-20 rounded-full blur-md" />
              )}
            </div>
            <span
              className={`text-[10px] font-medium transition-all duration-200 ${
                location.pathname.startsWith('/dashboard') ? 'opacity-100' : 'opacity-60'
              }`}
            >
              Dashboard
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
