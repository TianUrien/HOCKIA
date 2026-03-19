import { useEffect, useState } from 'react'

interface NotificationBadgeProps {
  count: number
  className?: string
  maxDisplay?: number
}

/**
 * NotificationBadge Component
 * 
 * A refined, modern notification badge with gradient styling and smooth animations.
 * Designed to integrate seamlessly with HOCKIA's glassmorphism and gradient-driven aesthetic.
 * 
 * Features:
 * - Gradient background (red to orange) with subtle glow
 * - Smooth fade + scale-in animation when count changes
 * - Support for single and multi-digit counts (1-9, 9+)
 * - Accessible with proper ARIA labels
 * - Fully responsive
 * 
 * @param count - Number of unread notifications
 * @param maxDisplay - Maximum number to display before showing "+" (default: 9)
 * @param className - Additional CSS classes for positioning
 */
export default function NotificationBadge({ 
  count, 
  className = '',
  maxDisplay = 9 
}: NotificationBadgeProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [displayCount, setDisplayCount] = useState(0)

  useEffect(() => {
    if (count > 0) {
      // Trigger animation when count appears
      setDisplayCount(count)
      setIsVisible(true)
    } else {
      // Fade out before hiding
      setIsVisible(false)
      // Wait for animation to complete before setting count to 0
      const timer = setTimeout(() => setDisplayCount(0), 200)
      return () => clearTimeout(timer)
    }
  }, [count])

  if (displayCount === 0 && !isVisible) return null

  const badgeText = displayCount > maxDisplay ? `${maxDisplay}+` : displayCount.toString()

  return (
    <span
      className={`notification-badge ${isVisible ? 'notification-badge--visible' : ''} ${className}`}
      aria-label={`${count} unread ${count === 1 ? 'notification' : 'notifications'}`}
      role="status"
      aria-live="polite"
    >
      {badgeText}
    </span>
  )
}
