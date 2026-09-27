import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The one lock badge on a video thumbnail ("clubs & coaches only"). A
 * near-solid ink circle with a thin light ring, so it reads on a black
 * frame (the ring) and on a bright one (the dark fill) — the old
 * translucent bg-black/55 vanished on dark corners and left a floating
 * white lock. Position it from the host (absolute left-2 top-2 by default).
 */
export function VideoLockBadge({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      data-testid="video-lock-badge"
      aria-label="Clubs and coaches only"
      role="img"
      className={cn(
        'pointer-events-none absolute flex items-center justify-center rounded-full bg-ink-1/90 text-white ring-1 ring-white/70 shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
        size === 'sm' ? 'left-1.5 top-1.5 h-5 w-5' : 'left-2 top-2 h-6 w-6',
        className,
      )}
    >
      <Lock className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.4} aria-hidden="true" />
    </span>
  )
}
