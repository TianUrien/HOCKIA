import { useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * Blur-up image (Motion spec 95:1012 §2): a ≤ 24 px placeholder — the tiny
 * Supabase / Cloudflare render, else a flat colour — blurred 20, then a 250 ms
 * cross-fade to the decoded image. Never an empty grey block; a cache hit
 * (already decoded on mount) appears at once, without the fade.
 * The box keeps its size from the parent (fixed aspect), so nothing shifts.
 */
export function BlurImage({ src, lqip, color, alt = '', className, imgClassName, eager = false, onLoad, onError }: {
  src: string
  lqip?: string | null
  /** Flat placeholder when there is no tiny render (e.g. a crest colour). */
  color?: string | null
  alt?: string
  className?: string
  imgClassName?: string
  eager?: boolean
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void
  onError?: () => void
}) {
  const ref = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [instant, setInstant] = useState(false)

  // Cache hit: decoded before first paint → show it without the fade.
  useLayoutEffect(() => {
    const img = ref.current
    if (img?.complete && img.naturalWidth > 0) {
      setInstant(true)
      setLoaded(true)
    }
  }, [src])

  return (
    <span className={cn('relative block overflow-hidden', className)} style={color && !loaded ? { backgroundColor: color } : undefined}>
      {lqip && !instant && (
        <img
          src={lqip}
          alt=""
          aria-hidden="true"
          decoding="async"
          className={cn('absolute inset-0 h-full w-full scale-110 object-cover blur-[20px] transition-opacity duration-[250ms]', loaded && 'opacity-0', imgClassName)}
        />
      )}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={(e) => { setLoaded(true); onLoad?.(e) }}
        onError={onError}
        className={cn(
          'relative h-full w-full object-cover',
          !instant && 'transition-opacity duration-[250ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:duration-150',
          loaded ? 'opacity-100' : 'opacity-0',
          imgClassName,
        )}
      />
    </span>
  )
}
