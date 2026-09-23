import { useState, type ImgHTMLAttributes } from 'react'
import { useNearViewport } from '@/hooks/useNearViewport'
import { cn } from '@/lib/utils'

/**
 * An image that is already loaded by the time it scrolls into view, and never
 * reads as broken while it loads.
 *
 * - Lookahead: unless `priority` / `eager`, the request starts when the box is
 *   within 1.5 screens of the viewport (an IntersectionObserver, not the
 *   browser's own lazy threshold, which is too short for a fast scroll on a
 *   slow link). Once near, it loads eagerly.
 * - Placeholder: the box keeps its neutral surface (#F2F2F7) until the bitmap
 *   has decoded, then fades in over 150ms. `decoding="async"` keeps the
 *   decode off the main thread.
 * - `priority` = above the fold: eager + fetchpriority=high.
 */
interface SmoothImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'decoding'> {
  priority?: boolean
  /** The first tiles of a screen: load now, normal priority. */
  eager?: boolean
  wrapperClassName?: string
  onLoaded?: () => void
}

export function SmoothImage({ priority = false, eager = false, className, wrapperClassName, onLoaded, onLoad, onError, src, srcSet, ...rest }: SmoothImageProps) {
  const [ready, setReady] = useState(false)
  const { ref, near } = useNearViewport<HTMLSpanElement>(priority || eager)
  return (
    <span ref={ref} className={cn('block h-full w-full bg-surface-grouped', wrapperClassName)}>
      {/* The element is always in the DOM (error → fallback wiring stays
          intact); only the SOURCE waits for the lookahead, so nothing is
          fetched for tiles far below. */}
      <img
        {...rest}
        src={near ? src : undefined}
        srcSet={near ? srcSet : undefined}
        loading="eager"
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
        onLoad={(e) => { setReady(true); onLoaded?.(); onLoad?.(e) }}
        onError={(e) => { setReady(true); onError?.(e) }}
        className={cn('h-full w-full transition-opacity duration-150 ease-out', ready ? 'opacity-100' : 'opacity-0', className)}
      />
    </span>
  )
}
