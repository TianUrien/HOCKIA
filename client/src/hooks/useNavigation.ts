/**
 * useNavigation
 *
 * Shared navigation helpers used by Header and MobileBottomNav.
 * Extracts duplicate isActive / handleNavigate / badge-count logic.
 */

import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useUnreadMessages } from '@/hooks/useUnreadMessages'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useNotificationStore } from '@/lib/notifications'

export function useNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuthStore()
  const { count: unreadCount } = useUnreadMessages()
  const { count: opportunityCount } = useOpportunityNotifications()
  const notificationCount = useNotificationStore((s) => s.unreadCount)
  const toggleNotificationDrawer = useNotificationStore((s) => s.toggleDrawer)

  const isActive = useCallback(
    (path: string) =>
      location.pathname === path || location.pathname.startsWith(path + '/'),
    [location.pathname],
  )

  const handleNavigate = useCallback(
    (path: string) => {
      toggleNotificationDrawer(false)
      navigate(path)
    },
    [navigate, toggleNotificationDrawer],
  )

  const profileInitials = (profile?.full_name ?? '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  return {
    user,
    profile,
    location,
    isActive,
    handleNavigate,
    toggleNotificationDrawer,
    unreadCount,
    opportunityCount,
    notificationCount,
    profileInitials,
  }
}
