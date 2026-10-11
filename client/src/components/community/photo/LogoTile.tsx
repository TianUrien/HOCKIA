import { useState } from 'react'
import { initialsOf } from '@/lib/communityCard'
import { cn } from '@/lib/utils'

/**
 * A white tile holding a club crest or brand logo (Community cards and
 * preview). Until the image decodes — or if it fails — the tile shows the
 * name's initials at 40 % ink over a soft pulse, never an empty white square.
 */
interface LogoTileProps {
  src: string
  name: string
  /** Size, radius, padding and shadow of the tile. */
  className: string
  /** Initials size for this tile. */
  initialsClassName?: string
  eager?: boolean
  onError?: () => void
}

export function LogoTile({ src, name, className, initialsClassName = 'text-[15px]', eager = false, onError }: LogoTileProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return (
    <span className={cn('relative flex items-center justify-center overflow-hidden bg-white', className)}>
      {state !== 'ready' && (
        <span aria-hidden="true" className={cn('absolute inset-0 flex items-center justify-center font-bold text-ink-1/40', state === 'loading' && 'animate-pulse', initialsClassName)}>
          {initialsOf(name)}
        </span>
      )}
      <img
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => { setState('failed'); onError?.() }}
        className={cn('relative h-full w-full object-contain transition-opacity duration-150', state === 'ready' ? 'opacity-100' : 'opacity-0')}
      />
    </span>
  )
}
