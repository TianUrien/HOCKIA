import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'
import { getImageUrl } from '@/lib/imageUrl'
import type { PostMediaItem } from '@/types/homeFeed'

interface MediaLightboxProps {
  images: PostMediaItem[]
  initialIndex: number
  onClose: () => void
}

/** Rubber-band resistance at carousel boundaries (0–1, lower = more resistance) */
const EDGE_RESISTANCE = 0.3

export function MediaLightbox({ images, initialIndex, onClose }: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const dialogRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useFocusTrap({ containerRef: dialogRef, isActive: true })

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, images.length - 1))
  }, [images.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const { containerRef, dragRef, isDraggingRef } = useSwipeGesture({
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
    onSwipeDown: onClose,
  })

  // rAF loop: read refs and apply transforms directly to DOM (no React re-renders during drag)
  useEffect(() => {
    const track = trackRef.current
    const dialog = dialogRef.current
    if (!track || !dialog) return

    let lastX = 0
    let lastY = 0
    let lastDragging = false

    function tick() {
      const offset = dragRef.current
      const dragging = isDraggingRef.current

      // Only write to DOM when values change
      if (offset.x !== lastX || offset.y !== lastY || dragging !== lastDragging) {
        lastX = offset.x
        lastY = offset.y
        lastDragging = dragging

        const viewportWidth = track!.parentElement?.clientWidth || window.innerWidth
        let dragPercent = viewportWidth > 0 ? (offset.x / viewportWidth) * 100 : 0

        // Edge resistance: dampen drag at boundaries
        const idx = currentIndex
        if ((idx === 0 && dragPercent > 0) || (idx === images.length - 1 && dragPercent < 0)) {
          dragPercent *= EDGE_RESISTANCE
        }

        const baseTranslate = -(idx * 100)
        const swipeDownY = offset.y
        const swipeDownOpacity = Math.max(0, 1 - offset.y / 300)

        if (dragging) {
          track!.style.transition = 'none'
          track!.style.transform = `translateX(${baseTranslate + dragPercent}%) translateY(${swipeDownY}px)`
          track!.style.opacity = swipeDownY > 0 ? String(swipeDownOpacity) : '1'
          dialog!.style.backgroundColor = `rgba(0, 0, 0, ${0.95 * swipeDownOpacity})`
        } else {
          // Snap: restore CSS transition
          track!.style.transition = 'transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 300ms ease-out'
          track!.style.transform = `translateX(${baseTranslate}%)`
          track!.style.opacity = '1'
          dialog!.style.backgroundColor = 'rgba(0, 0, 0, 0.95)'
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [currentIndex, images.length, dragRef, isDraggingRef])

  // Keyboard navigation + Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowRight':
          goNext()
          break
        case 'ArrowLeft':
          goPrev()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, goNext, goPrev])

  // Scroll lock
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const hasMultiple = images.length > 1
  const isFirst = currentIndex === 0
  const isLast = currentIndex === images.length - 1

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1000] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      tabIndex={-1}
      onClick={onClose}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.95)' }}
    >
      {/* Header: close button + position indicator */}
      <div className="flex items-center justify-between px-4 py-3 relative z-10">
        <div className="w-10" />
        {hasMultiple && (
          <span
            className="text-white/80 text-sm font-medium"
            aria-live="polite"
          >
            {currentIndex + 1} / {images.length}
          </span>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="w-10 h-10 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Carousel — touch-action: none prevents browser gesture interference */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{ touchAction: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={trackRef}
          className="flex h-full"
          style={{
            transform: `translateX(${-(currentIndex * 100)}%)`,
            transition: 'transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          }}
        >
          {images.map((media, i) => (
            <div
              key={media.url}
              className="w-full h-full flex-shrink-0 flex items-center justify-center px-4"
            >
              {(media.media_type ?? 'image') === 'video' ? (
                <LightboxVideoSlide
                  src={media.url}
                  poster={media.thumb_url}
                  isActive={i === currentIndex}
                  isDragging={isDraggingRef}
                />
              ) : (
                <img
                  src={getImageUrl(media.url, 'lightbox') ?? undefined}
                  alt={`Post media ${i + 1}${hasMultiple ? ` of ${images.length}` : ''}`}
                  className="max-w-full max-h-[85vh] object-contain select-none pointer-events-none"
                  draggable={false}
                  loading={Math.abs(i - currentIndex) <= 1 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              )}
            </div>
          ))}
        </div>

        {/* Desktop arrow buttons */}
        {hasMultiple && !isFirst && (
          <button
            type="button"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
            className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {hasMultiple && !isLast && (
          <button
            type="button"
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation()
              goNext()
            }}
            className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Lightbox Video Slide
// ---------------------------------------------------------------------------
// Lightweight video player designed for the lightbox carousel.
// Key design: pointer-events-none on the <video> element ensures swipe
// gestures pass through to the parent carousel. Play/pause and controls
// are handled by overlay buttons that use stopPropagation to avoid
// interfering with the carousel's swipe detection.
// ---------------------------------------------------------------------------

function LightboxVideoSlide({
  src,
  poster,
  isActive,
  isDragging,
}: {
  src: string
  poster?: string | null
  isActive: boolean
  isDragging: React.RefObject<boolean>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [hasStarted, setHasStarted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tapStartRef = useRef<{ x: number; y: number; time: number } | null>(null)

  // Pause video when slide becomes inactive
  useEffect(() => {
    if (!isActive && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
    }
  }, [isActive])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setHasStarted(true)
    } else {
      video.pause()
    }
  }, [])

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowControls(true)
    if (isPlaying) {
      hideTimer.current = setTimeout(() => setShowControls(false), 2500)
    }
  }, [isPlaying])

  // Tap detection: distinguish tap (play/pause) from swipe (carousel nav).
  // We track pointerdown → pointerup distance; if < 10px and < 300ms, it's a tap.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    tapStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const start = tapStartRef.current
    tapStartRef.current = null
    if (!start) return

    // If the carousel is/was dragging, don't treat as a tap
    if (isDragging.current) return

    const dx = Math.abs(e.clientX - start.x)
    const dy = Math.abs(e.clientY - start.y)
    const dt = Date.now() - start.time

    if (dx < 10 && dy < 10 && dt < 300) {
      e.stopPropagation()
      togglePlay()
      scheduleHideControls()
    }
  }, [isDragging, togglePlay, scheduleHideControls])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video || !duration) return
    setCurrentTime(video.currentTime)
    setProgress((video.currentTime / duration) * 100)
  }, [duration])

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRef.current
    const bar = (e.currentTarget as HTMLElement)
    if (!video || !duration) return
    const rect = bar.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    video.currentTime = percent * duration
  }, [duration])

  const handleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const el = wrapperRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen()
    }
  }, [])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div
      ref={wrapperRef}
      className="relative max-w-full max-h-[85vh] w-full flex items-center justify-center"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onMouseMove={scheduleHideControls}
    >
      {/* Video element — pointer-events-none so swipes pass through to carousel */}
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        muted={isMuted}
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration)
        }}
        onEnded={() => {
          setIsPlaying(false)
          setProgress(0)
          setCurrentTime(0)
          setShowControls(true)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false)
          setShowControls(true)
        }}
        className="max-w-full max-h-[85vh] object-contain select-none pointer-events-none"
        draggable={false}
      />

      {/* Large center play button (before first play) */}
      {!hasStarted && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-8 h-8 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {hasStarted && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-2 px-3 transition-opacity duration-200 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress bar */}
          <div
            className="w-full h-1.5 bg-white/30 rounded-full cursor-pointer mb-2 group"
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-white rounded-full relative transition-all"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); togglePlay() }}
                className="text-white hover:text-white/80 transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" fill="white" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5" fill="white" />
                )}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  const video = videoRef.current
                  if (!video) return
                  video.muted = !video.muted
                  setIsMuted(video.muted)
                }}
                className="text-white hover:text-white/80 transition-colors"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>

              <span className="text-xs text-white/80 font-mono tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <button
              type="button"
              onClick={handleFullscreen}
              className="text-white hover:text-white/80 transition-colors"
              aria-label="Fullscreen"
            >
              <Maximize className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
