import { useEffect, useState, useRef } from 'react'
import { Home, Users, Briefcase, Inbox, UserPlus } from 'lucide-react'
import Avatar from './Avatar'
import { useNavigation } from '@/hooks/useNavigation'
import { hapticSelection } from '@/lib/haptics'
import { trackSignupCtaClick } from '@/lib/analytics'
import { useAuthStore } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useInboxDot } from '@/lib/inboxSeen'

interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  /** Unread indicator (Figma tab bar carries no counts — a quiet dot). */
  dot?: boolean
}

/**
 * Tab bar v3 (Figma 02 Components / 03 Player): Home · Community ·
 * Opportunities · Inbox · Profile. No Clubs tab — clubs are members,
 * reached through Search and the Community role filter — and no floating
 * Hockia AI button — the assistant lives inside Search (founder rulings
 * 2026-09-20). 26px icons, 10px medium labels, purple = the selected tab.
 */
export default function MobileBottomNav() {
  const { user, profile, location, isActive, handleNavigate } = useNavigation()
  const pointerTapRef = useRef(false)
  const inboxDot = useInboxDot()
  const authLoading = useAuthStore((s) => s.loading)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [isHidden, setIsHidden] = useState(false)

  // Keyboard detection (iOS): a large visual-viewport shrink means the
  // keyboard is up and the bar would float above it.
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined' && window.visualViewport) {
        const heightDiff = window.innerHeight - window.visualViewport.height
        setIsKeyboardOpen(heightDiff > 150)
      }
    }
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
      return () => window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [])

  // Focused flows and immersive views have no tab bar: auth, onboarding,
  // the Hockia AI screen (reached from Search, back-only) and an open chat.
  useEffect(() => {
    const hiddenRoutes = ['/', '/signup', '/login', '/complete-profile', '/discover']
    const searchParams = new URLSearchParams(location.search)
    const isConversationPath = location.pathname.startsWith('/messages/')
    const hasMessagesOverlayParam = searchParams.has('conversation') || searchParams.has('new')
    const isImmersiveMessagesView =
      location.pathname.startsWith('/messages') && (isConversationPath || hasMessagesOverlayParam)
    // Detail screens with their own fixed action bar (Figma Opportunity
    // detail: Message / Apply) carry no tab bar — back is the way out.
    const isOpportunityDetail = /^\/opportunities\/(?!applications$)[^/]+$/.test(location.pathname)
    // Modal flows with their own bottom action (Figma 04 Club · Link your club).
    const isModalFlow = location.pathname === '/dashboard/profile/link' ||
      // D2 Cancel / Save screens: Passports & permits, Open to play (Figma D2.3, D2.4).
      location.pathname === '/dashboard/profile/passports' || location.pathname === '/dashboard/profile/open-to-play' ||
      // Post a role: a full-screen flow with its own Continue bar (Figma 04 Club 330:318),
      // and its Role posted screen (D1.26) with its own buttons.
      location.pathname === '/dashboard/opportunities/new' || /^\/dashboard\/opportunities\/[^/]+\/(edit|posted)$/.test(location.pathname) ||
      // Applicant review carries its own decision bar (Figma 04 Club 326:319).
      /^\/dashboard\/opportunities\/[^/]+\/applicants\/[^/]+$/.test(location.pathname)
    setIsHidden(hiddenRoutes.some((route) => location.pathname === route) || isImmersiveMessagesView || isOpportunityDetail || isModalFlow)
  }, [location.pathname, location.search])

  if (isHidden || isKeyboardOpen) return null

  // While the session resolves, `user` is null for everyone — rendering the
  // guest bar would flash "Join" at a signed-in member. Wait it out.
  if (authLoading) return null

  // Signed in but no profile yet = mid-signup; no bar until onboarding ends.
  if (user && !profile) return null



  const renderTab = (item: NavItem, active: boolean) => {
    const Icon = item.icon
    return (
      <button
        key={item.id}
        type="button"
        onPointerDown={() => { pointerTapRef.current = true }}
        onClick={(e) => {
          void hapticSelection()
          // A tap must not leave the tab focused (the global :focus-visible
          // outline would trail it); keyboard activation has no pointerdown
          // and keeps its focus ring.
          if (pointerTapRef.current) e.currentTarget.blur()
          pointerTapRef.current = false
          handleNavigate(item.path)
        }}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-[52px] flex-1 flex-col items-center gap-[3px] pb-1 pt-[7px] transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hockia-primary focus-visible:rounded-xl',
          active ? 'text-hockia-primary' : 'text-ink-2',
        )}
      >
        <span className="relative flex h-[26px] w-[26px] items-center justify-center">
          <Icon className="h-[26px] w-[26px]" strokeWidth={active ? 2.2 : 1.85} />
          {item.dot && <span aria-label="Unread" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-hockia-primary ring-2 ring-white" />}
        </span>
        {/* Labels hide below 360px where five 10px labels no longer share a row. */}
        <span className="hidden text-tab min-[360px]:inline">{item.label}</span>
      </button>
    )
  }

  const barClassName =
    'lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] [transform:translate3d(0,0,0)] [backface-visibility:hidden]'

  // ── Guest exploration bar ────────────────────────────────────────────────
  // Guests keep a bar on the public explore surface (Community, Opportunities
  // and the profiles they open from there) plus a conversion slot. Anywhere
  // else — sign-in, verify-email, invite, terms — is a focused flow.
  if (!user) {
    const GUEST_BAR_ROUTES = [
      '/world', '/opportunities', '/community',
      '/players', '/coaches', '/clubs', '/umpires', '/brands', '/members', '/marketplace', '/post',
    ]
    const onExploreArea = GUEST_BAR_ROUTES.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
    if (!onExploreArea) return null

    const guestItems: NavItem[] = [
      { id: 'community', label: 'Community', path: '/community', icon: Users },
      { id: 'opportunities', label: 'Opportunities', path: '/opportunities', icon: Briefcase },
    ]

    return (
      <>
        <div className="h-20 lg:hidden" aria-hidden="true" />
        <nav className={barClassName} aria-label="Explore Hockia">
          <div className="flex items-stretch px-1.5">
            {guestItems.map((item) => renderTab(item, isActive(item.path)))}
            {/* Conversion slot: a filled pill reads as an action, so the two
                areas stay legible as "places". Log in lives in the header. */}
            <button
              type="button"
              onClick={() => {
                void hapticSelection()
                trackSignupCtaClick('guest_nav')
                handleNavigate('/signup')
              }}
              className="flex min-h-[52px] flex-1 flex-col items-center gap-[3px] pb-1 pt-[7px] text-hockia-primary active:scale-95"
              aria-label="Create a profile"
            >
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-hockia-primary">
                <UserPlus className="h-[15px] w-[15px] text-white" strokeWidth={2.5} />
              </span>
              <span className="hidden text-tab font-semibold min-[360px]:inline">Join</span>
            </button>
          </div>
        </nav>
      </>
    )
  }

  const navItems: NavItem[] = [
    { id: 'home', label: 'Home', path: '/home', icon: Home },
    { id: 'community', label: 'Community', path: '/community', icon: Users },
    { id: 'opportunities', label: 'Opportunities', path: '/opportunities', icon: Briefcase },
    // Unread messages, or activity/requests newer than the last time that
    // segment was opened (lib/inboxSeen).
    { id: 'inbox', label: 'Inbox', path: '/inbox', icon: Inbox, dot: inboxDot },
  ]

  // A role's applicants and reviews live under /dashboard/opportunities but
  // belong to the Opportunities tab (Figma 04 Club · Applicants).
  const onClubRecruiting = location.pathname.startsWith('/dashboard/opportunities')
  const onProfile = location.pathname.startsWith('/dashboard') && !onClubRecruiting
  const initials =
    (profile?.full_name ?? '')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  return (
    <>
      {/* Spacer so content never ends behind the fixed bar */}
      <div className="h-20 lg:hidden" aria-hidden="true" />

      <nav className={barClassName} aria-label="Main">
        <div className="flex items-stretch px-1.5">
          {navItems.map((item) => renderTab(item, isActive(item.path) || (item.id === 'inbox' && isActive('/messages')) || (item.id === 'opportunities' && onClubRecruiting)))}

          {/* Profile = the member's own avatar (Figma tab/Profile). */}
          <button
            type="button"
            onClick={() => handleNavigate('/dashboard/profile')}
            aria-label="Profile"
            aria-current={onProfile ? 'page' : undefined}
            className={cn(
              'flex min-h-[52px] flex-1 flex-col items-center gap-[3px] pb-1 pt-[7px] transition-colors',
              onProfile ? 'text-hockia-primary' : 'text-ink-2',
            )}
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center">
              <Avatar
                src={profile?.avatar_url}
                initials={initials}
                size="sm"
                loading="eager"
                role={profile?.role}
                className={cn('!h-[26px] !w-[26px]', onProfile && 'ring-2 ring-hockia-primary ring-offset-1')}
              />
            </span>
            <span className="hidden text-tab min-[360px]:inline">Profile</span>
          </button>
        </div>
      </nav>
    </>
  )
}
