import { useState } from 'react'
import RolePlaceholder from '@/components/RolePlaceholder'
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
  /** No-photo treatment when the logo fails: club violet (default) or brand ink. */
  role?: 'club' | 'brand'
}

export function LogoTile({ src, name, className, eager = false, onError, role = 'club' }: LogoTileProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  // The caller may place the tile (absolute …); otherwise it anchors its own
  // initials layer. Never both: CSS order would let `relative` win.
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className)
  return (
    <span className={cn(positioned ? '' : 'relative', 'flex items-center justify-center overflow-hidden bg-white', className)}>
      {state === 'failed' && (
        <span aria-hidden="true" className="absolute inset-0"><RolePlaceholder role={role} name={name} label="" /></span>
      )}
      {state === 'loading' && (
        <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-surface-muted" />
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
