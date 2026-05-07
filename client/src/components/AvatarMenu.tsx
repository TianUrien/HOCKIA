import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, Settings, LogOut } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import Avatar from './Avatar'

/**
 * AvatarMenu — single header dropdown anchored to the user's avatar.
 *
 * Replaces the dual surface that used to live in the header:
 *   - Avatar (profile pic, click went to /dashboard/profile)
 *   - DashboardMenu (hamburger ≡, click revealed Settings + Sign out)
 *
 * Industry convention is avatar = profile menu (Google, GitHub, Twitter)
 * and the hamburger pattern was hiding Settings + Sign out from new users
 * who don't think to look there. Consolidating into one trigger gives:
 *   - "Your dashboard"  → /dashboard/profile (preserves the old one-tap)
 *   - "Settings"        → /settings
 *   - "Sign out"
 *
 * Implementation mirrors DashboardMenu's portal + click-outside + escape
 * mechanics so positioning stays robust under sticky headers / scroll.
 */

interface AvatarMenuProps {
  /** True when the active route is /dashboard/* — drives the focus ring on the avatar. */
  isOnDashboard: boolean
  className?: string
}

export default function AvatarMenu({ isOnDashboard, className = '' }: AvatarMenuProps) {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()
  const { addToast } = useToastStore()
  const closeNotificationsDrawer = useNotificationStore((state) => state.toggleDrawer)
  const [isOpen, setIsOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined'

  // Position the dropdown right-aligned to the avatar so it never spills
  // past the viewport edge.
  const updatePos = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    updatePos()
    const handle = () => updatePos()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [isOpen, updatePos])

  useEffect(() => {
    if (!isOpen) return
    const handlePointer = (event: Event) => {
      const target = event.target as Node | null
      if (!target) return
      const inButton = buttonRef.current?.contains(target) ?? false
      const inDropdown = dropdownRef.current?.contains(target) ?? false
      if (!inButton && !inDropdown) setIsOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  if (!profile) return null

  const profileInitials = profile.full_name
    ? profile.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '??'

  const handleNavigate = (path: string) => {
    setIsOpen(false)
    closeNotificationsDrawer(false)
    navigate(path)
  }

  const handleSignOut = async () => {
    setIsOpen(false)
    try {
      closeNotificationsDrawer(false)
      await signOut()
      navigate('/')
    } catch (error) {
      logger.error('Failed to sign out', error)
      addToast('Could not sign out. Please try again.', 'error')
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`flex items-center rounded-full transition-all ${
          isOnDashboard ? 'ring-2 ring-[#8026FA] ring-offset-2' : 'hover:opacity-80'
        } ${className}`}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen ? 'true' : 'false'}
      >
        <Avatar
          src={profile.avatar_url}
          initials={profileInitials}
          size="sm"
          loading="eager"
          role={profile.role}
        />
      </button>

      {isOpen && canUseDOM && pos &&
        createPortal(
          <div
            ref={dropdownRef}
            role="menu"
            aria-orientation="vertical"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[9999] w-56 rounded-xl border border-gray-200/60 bg-white py-2 shadow-2xl animate-fade-in"
          >
            {/* Identity row — gives the menu visual context. */}
            <div className="px-4 pb-2 pt-1">
              <p className="truncate text-sm font-semibold text-gray-900">
                {profile.full_name ?? 'Your account'}
              </p>
              {profile.username && (
                <p className="truncate text-xs text-gray-500">@{profile.username}</p>
              )}
            </div>
            <div className="my-1 h-px bg-gray-200" />
            <button
              type="button"
              role="menuitem"
              onClick={() => handleNavigate('/dashboard/profile')}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <LayoutDashboard className="h-4 w-4" />
              Your dashboard
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleNavigate('/settings')}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            <div className="my-1 h-px bg-gray-200" />
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
