import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import RolePlaceholder from '@/components/RolePlaceholder'
import { cn } from '@/lib/utils'
import { getImageUrl, type ImageSize } from '@/lib/imageUrl'
import { ORG_SHAPE, orgImageClass } from '@/lib/orgImage'

interface OrgLogoProps {
  src: string
  /** Read by screen readers; leave empty when the name is next to the logo. */
  alt?: string
  /** No-image treatment if the file fails to load. */
  role?: 'club' | 'brand'
  /** Size, position and shadow of the tile. The shape is not the caller's to choose. */
  className?: string
  style?: CSSProperties
  /** Serve a resized variant instead of the stored file. */
  imageSize?: ImageSize
  eager?: boolean
  onError?: () => void
}

/**
 * THE tile for a club crest or a brand logo (founder 2026-11-20): a white
 * rounded square, radius 25 % of its side, at every size and on every
 * surface. A logo fitted by the crop step fills it edge to edge and is
 * clipped by the radius; an older upload sits inside it with rounded corners
 * of its own. People are circles (`Avatar`).
 */
export function OrgLogo({ src, alt = '', role = 'club', className, style, imageSize, eager = false, onError }: OrgLogoProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => { setState('loading') }, [src])
  const shown = imageSize ? getImageUrl(src, imageSize) ?? src : src
  // The caller may place the tile (absolute …); otherwise it anchors its own
  // layers. Never both: CSS order would let `relative` win.
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className ?? '')
  return (
    <span className={cn(positioned ? '' : 'relative', 'block shrink-0 overflow-hidden bg-white', ORG_SHAPE, className)} style={style} data-org-logo={state}>
      {state === 'failed' ? (
        <span aria-hidden="true" className="absolute inset-0"><RolePlaceholder role={role} label="" /></span>
      ) : (
        <>
          {state === 'loading' && <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-surface-muted" />}
          <img
            src={shown}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            // A cached image can finish before React attaches onLoad.
            ref={(el) => { if (el?.complete && el.naturalWidth > 0) setState((s) => (s === 'loading' ? 'ready' : s)) }}
            onLoad={() => setState('ready')}
            onError={() => { setState('failed'); onError?.() }}
            className={cn(orgImageClass(src), 'transition-opacity duration-150', state === 'ready' ? 'opacity-100' : 'opacity-0')}
          />
          {/* Hairline over the image, so a logo the colour of the page still has an edge. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10" />
        </>
      )}
    </span>
  )
}
