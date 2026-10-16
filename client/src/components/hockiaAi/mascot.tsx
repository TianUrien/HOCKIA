import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/lib/spring'
import { cn } from '@/lib/utils'

/** Hockia AI mascot assets (public/hockia-ai, see PROVENANCE.md): CG, Blender, no AI generators. */
const BASE = '/hockia-ai'

export type MascotState = 'calm' | 'thinking' | 'confused' | 'idea' | 'active'
export type MascotClipName = 'wave' | 'idle' | 'think' | 'avatar_thinking_loop'

/** Circle avatar (handoff: 36 pt inside a 42 pt mind-light ring for assistant turns). */
export function MascotAvatar({ state = 'calm', size = 36, ring = false, className }: { state?: MascotState; size?: number; ring?: boolean; className?: string }) {
  const px = size > 64 ? 256 : 128
  const img = <img src={`${BASE}/avatar_${state}_${px}.webp`} alt="" width={size} height={size} className="block rounded-full" style={{ width: size, height: size }} draggable={false} />
  if (!ring) return <span className={cn('inline-flex shrink-0', className)} aria-hidden="true">{img}</span>
  const outer = Math.round(size * (42 / 36))
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: outer, height: outer, background: 'radial-gradient(circle, rgba(167,139,250,0.35) 55%, rgba(167,139,250,0) 72%)' }}
      aria-hidden="true"
    >
      {img}
    </span>
  )
}

/**
 * A mascot clip with alpha: HEVC first (iOS / WKWebView), then WebM VP9
 * (Chrome / Android), the poster as fallback. Reduce Motion → poster only.
 * One-shots call onEnded so the caller can cross to `idle`.
 */
export function MascotClip({ clip, loop = false, onEnded, height, className }: { clip: MascotClipName; loop?: boolean; onEnded?: () => void; height: number; className?: string }) {
  const [still] = useState(prefersReducedMotion)
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v || still) return
    v.load()
    void v.play().catch(() => undefined)
  }, [clip, still])
  const poster = `${BASE}/${clip}_poster.webp`
  if (still) return <img src={poster} alt="" style={{ height }} className={cn('block w-auto', className)} aria-hidden="true" />
  return (
    <video
      ref={ref}
      key={clip}
      muted
      playsInline
      autoPlay
      loop={loop}
      onEnded={onEnded}
      poster={poster}
      style={{ height }}
      className={cn('block w-auto bg-transparent', className)}
      aria-hidden="true"
      data-testid={`mascot-clip-${clip}`}
    >
      <source src={`${BASE}/${clip}_hevc-alpha.mp4`} type='video/mp4; codecs="hvc1"' />
      <source src={`${BASE}/${clip}.webm`} type="video/webm" />
    </video>
  )
}

/** Hello on open, then a seamless idle loop (handoff: wave → crossfade into idle). */
export function MascotHello({ height, className }: { height: number; className?: string }) {
  const [clip, setClip] = useState<MascotClipName>('wave')
  return <MascotClip clip={clip} loop={clip === 'idle'} onEnded={() => setClip('idle')} height={height} className={className} />
}
