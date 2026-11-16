import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Menu, Settings, LogOut, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { useCommonT } from '@/i18n/ns/common'

/**
 * DashboardMenu - Hamburger menu for Dashboard pages
 * 
 * Contains Settings and Sign Out options.
 * Dropdown is anchored to the hamburger button position.
 */
export default function DashboardMenu() {
  const navigate = useNavigate()
  const { signOut } = useAuthStore()
  const t = useCommonT()
  const { addToast } = useToastStore()
  const toggleNotificationDrawer = useNotificationStore((state) => state.toggleDrawer)
  const closeNotificationsDrawer = () => toggleNotificationDrawer(false)
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined'

  // Calculate dropdown position based on button location
  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return
    
    const buttonRect = buttonRef.current.getBoundingClientRect()
    const dropdownWidth = 192 // w-48 = 12rem = 192px
    const viewportWidth = window.innerWidth
    
    // Position dropdown below the button, aligned to button's left edge
    let left = buttonRect.left
    
    // Ensure dropdown doesn't overflow right edge of viewport
    if (left + dropdownWidth > viewportWidth - 16) {
      left = viewportWidth - dropdownWidth - 16
    }
    
    // Ensure dropdown doesn't overflow left edge
    if (left < 16) {
      left = 16
    }
    
    setDropdownPosition({
      top: buttonRect.bottom + 8, // 8px gap below button
      left
    })
  }, [])

  // Update position when menu opens or on scroll/resize
  useEffect(() => {
    if (!isOpen) return
    
    updateDropdownPosition()
    
    const handleUpdate = () => updateDropdownPosition()
    window.addEventListener('scroll', handleUpdate, true)
    window.addEventListener('resize', handleUpdate)
    
    return () => {
      window.removeEventListener('scroll', handleUpdate, true)
      window.removeEventListener('resize', handleUpdate)
    }
  }, [isOpen, updateDropdownPosition])

  // Close menu when clicking outside (works with portal)
  useEffect(() => {
    const handlePointerDownOutside = (event: Event) => {
      const target = event.target as Node | null
      if (!target) return

      const clickedButton = buttonRef.current?.contains(target) ?? false
      const clickedDropdown = dropdownRef.current?.contains(target) ?? false
      if (!clickedButton && !clickedDropdown) setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('pointerdown', handlePointerDownOutside)
      return () => document.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [isOpen])

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleNavigate = (path: string) => {
    setIsOpen(false)
    closeNotificationsDrawer()
    navigate(path)
  }

  const handleSignOut = async () => {
    setIsOpen(false)
    try {
      closeNotificationsDrawer()
      await signOut()
      navigate('/')
    } catch (error) {
      logger.error('Failed to sign out', error)
      addToast(t('dashboardMenu.signOutFailed'), 'error')
    }
  }

  return (
    <div className="relative">
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        ref={buttonRef}
        className={`p-2.5 rounded-xl transition-all duration-200 ${
          isOpen
            ? 'bg-gray-100 text-gray-900'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
        aria-label={isOpen ? t('dashboardMenu.close') : t('dashboardMenu.open')}
      >
        {isOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <Menu className="w-5 h-5" />
        )}
      </button>

      {/* Dropdown Menu (portaled to body, anchored to hamburger button position) */}
      {isOpen && canUseDOM && dropdownPosition &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-48 bg-white rounded-xl shadow-2xl border border-gray-200/50 py-2 z-[9999] animate-fade-in"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
            }}
            role="menu"
            aria-orientation="vertical"
          >
            <button
              onClick={() => handleNavigate('/settings')}
              className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-3"
              role="menuitem"
            >
              <Settings className="w-5 h-5" />
              {t('dashboardMenu.settings')}
            </button>
            <div className="h-px bg-gray-200 my-1" />
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-3"
              role="menuitem"
            >
              <LogOut className="w-5 h-5" />
              {t('dashboardMenu.signOut')}
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
