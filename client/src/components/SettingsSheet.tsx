import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Settings as SettingsIcon, LogOut } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

/**
 * SettingsSheet — gear-icon trigger + dropdown menu hosting Settings +
 * Sign out. Replaces the equivalent items that used to live inside
 * AvatarMenu (the avatar in the mobile bottom nav now navigates to the
 * dashboard directly, not opens a menu).
 *
 * Mirrors AvatarMenu's portal + click-outside + escape mechanics so
 * positioning stays robust under sticky headers / scroll.
 */
interface SettingsSheetProps {
  /** Extra class on the trigger button. */
  className?: string
}

export default function SettingsSheet({ className = '' }: SettingsSheetProps) {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()
  const { addToast } = useToastStore()
  const closeNotificationsDrawer = useNotificationStore((state) => state.toggleDrawer)

  const [isOpen, setIsOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined'

  // When SettingsSheet opens, broadcast so other dismissible overlays
  // (InfoTooltip etc.) close themselves. Avoids the double-open state
  // QA caught — both SettingsSheet dropdown and the Open-to-Play
  // tooltip visible at the same time.
  useEffect(() => {
    if (!isOpen) return
    document.dispatchEvent(
      new CustomEvent('hockia:overlay-opened', { detail: { source: 'settings-sheet' } }),
    )
  }, [isOpen])

  // Conversely, close ourselves when another overlay broadcasts open.
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail
      if (detail?.source === 'settings-sheet') return
      setIsOpen(false)
    }
    document.addEventListener('hockia:overlay-opened', handler)
    return () => document.removeEventListener('hockia:overlay-opened', handler)
  }, [isOpen])

  const updatePos = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    setPos({ top: rect.bottom + 8, right })
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
        className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 transition-colors ${className}`}
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={isOpen ? 'true' : 'false'}
        title="Settings"
        data-testid="settings-sheet-trigger"
      >
        <SettingsIcon className="w-5 h-5" />
      </button>

      {isOpen && canUseDOM && pos &&
        createPortal(
          <div
            ref={dropdownRef}
            role="menu"
            aria-orientation="vertical"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[9999] w-56 rounded-xl border border-gray-200/60 bg-white py-2 shadow-2xl animate-fade-in"
            data-testid="settings-sheet-menu"
          >
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
              onClick={() => handleNavigate('/settings')}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <SettingsIcon className="h-4 w-4" />
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
