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
  // The spacer opens at the top of the page, which sits under the fixed app
  // header — so the indicator is drawn fixed, just below the header, inside
  // the gap the pull reveals. (Measured at touch start; 0 without a header.)
  const [headerBottom, setHeaderBottom] = useState(0)

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
      const header = document.querySelector('header.fixed')
      setHeaderBottom(header ? Math.max(0, header.getBoundingClientRect().bottom) : 0)
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
          className="overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: isRefreshing ? 48 : pullDistance }}
          aria-hidden="true"
        >
          {/* A field-hockey ball rolls with the pull, spins while loading,
              then the row springs closed. */}
          <span
            className="pointer-events-none fixed left-1/2 z-40 flex items-center justify-center"
            style={{
              top: headerBottom + (isRefreshing ? 48 : pullDistance) / 2 - 10,
              opacity: progress,
              transform: `translateX(-50%) scale(${0.6 + progress * 0.4})`,
            }}
          >
            <span className={isRefreshing ? 'hockia-ball-spin' : undefined} style={isRefreshing ? undefined : { transform: `rotate(${pullDistance * 4}deg)` }}>
              <HockeyBall spinning={isRefreshing} />
            </span>
          </span>
        </div>
      )}
      {isRefreshing && <span className="sr-only" role="status">Refreshing</span>}
      {children}
    </>
  )
}

/** 20 pt ball with one seam so the roll reads (Figma review 11 Oct): ink
 *  secondary while pulling, brand at 70 % while it spins. */
function HockeyBall({ spinning }: { spinning: boolean }) {
  const ink = spinning ? 'rgba(108, 43, 217, 0.7)' : '#5b5b6b'
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8.75" fill="white" stroke={ink} strokeWidth="1.5" />
      <path d="M4.2 5.6c3.2 2 3.2 6.8 0 8.8M15.8 5.6c-3.2 2-3.2 6.8 0 8.8" stroke={ink} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
