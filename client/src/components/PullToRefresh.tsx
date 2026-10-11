import { useState, useRef, useCallback, useEffect } from 'react'
import { hapticLight, hapticSuccess } from '@/lib/haptics'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
}

// Motion 95:1012 §5: threshold 72 pt with a light haptic as it's crossed.
const THRESHOLD = 72
const MAX_PULL = 120

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const armed = useRef(false)

  // Skip pull-to-refresh when the body is scroll-locked — this is the
  // convention modals use to prevent underlying scroll, and we should respect
  // it instead of hijacking touchmove inside the modal (which would break
  // in-modal scrolling and, if pulled past threshold, remount the page under
  // the modal).
  const isBodyLocked = () => document.body.style.overflow === 'hidden'

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (isBodyLocked()) return
    if (window.scrollY <= 0 && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [isRefreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling.current || isRefreshing) return
    if (isBodyLocked()) {
      isPulling.current = false
      setPullDistance(0)
      return
    }

    const deltaY = e.touches[0].clientY - touchStartY.current
    if (deltaY <= 0) {
      setPullDistance(0)
      return
    }

    // Only prevent default when we're actually pulling to refresh
    if (window.scrollY <= 0 && deltaY > 10) {
      e.preventDefault()
    }

    const distance = Math.min(deltaY * 0.5, MAX_PULL)
    if (distance >= THRESHOLD && !armed.current) { armed.current = true; void hapticLight() }
    if (distance < THRESHOLD) armed.current = false
    setPullDistance(distance)
  }, [isRefreshing])

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || isRefreshing) return
    isPulling.current = false

    if (pullDistance >= THRESHOLD) {
      setIsRefreshing(true)
      setPullDistance(THRESHOLD)
      try {
        await onRefresh()
        // Native-only success tick when the refresh actually completes.
        void hapticSuccess()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, isRefreshing, onRefresh])

  useEffect(() => {
    const options: AddEventListenerOptions = { passive: false }
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, options)
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  const progress = Math.min(pullDistance / THRESHOLD, 1)
  const showIndicator = pullDistance > 10 || isRefreshing

  return (
    <>
      {showIndicator && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: isRefreshing ? 48 : pullDistance }}
          aria-hidden="true"
        >
          {/* A field-hockey ball rolls with the pull, spins while loading,
              then the row springs closed. */}
          <span
            className="flex items-center justify-center"
            style={{ opacity: progress, transform: `scale(${0.6 + progress * 0.4})` }}
          >
            <span className={isRefreshing ? 'hockia-ball-spin' : undefined} style={isRefreshing ? undefined : { transform: `rotate(${pullDistance * 4}deg)` }}>
              <HockeyBall />
            </span>
          </span>
        </div>
      )}
      {isRefreshing && <span className="sr-only" role="status">Refreshing</span>}
      {children}
    </>
  )
}

/** 12 pt dimpled ball (white, ink hairline) — reads on white and grey grounds. */
function HockeyBall() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6.25" fill="white" stroke="#6f6f7c" strokeWidth="1" />
      <circle cx="4.6" cy="5" r="0.9" fill="#aeaeb2" />
      <circle cx="8.4" cy="4.2" r="0.9" fill="#aeaeb2" />
      <circle cx="9.6" cy="8" r="0.9" fill="#aeaeb2" />
      <circle cx="6" cy="9.4" r="0.9" fill="#aeaeb2" />
      <circle cx="7" cy="6.6" r="0.7" fill="#6c2bd9" />
    </svg>
  )
}
