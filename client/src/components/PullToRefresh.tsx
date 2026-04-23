import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
}

const THRESHOLD = 80
const MAX_PULL = 120

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)

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
        >
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white shadow-md border border-gray-100"
            style={{
              opacity: progress,
              transform: `scale(${0.5 + progress * 0.5}) rotate(${pullDistance * 3}deg)`,
            }}
          >
            <Loader2
              className={`w-4 h-4 text-[#8026FA] ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </div>
        </div>
      )}
      {children}
    </>
  )
}
