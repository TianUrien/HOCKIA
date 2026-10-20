import type { CSSProperties, ReactNode } from 'react'
import { coverBackground, type CrestPalette } from '@/lib/crestPalette'
import { getImageUrl } from '@/lib/imageUrl'

interface RoleCoverProps {
  /** The role's own cover photo (opportunities.cover_url); null = generated cover. */
  coverUrl?: string | null
  /** Crest shown as the watermark of a generated cover. */
  crestUrl?: string | null
  /** Club palette from the crest (useClubCrestPalettes); null = Hockia violet. */
  palette: CrestPalette | null | undefined
  /** Bottom scrim strength: 'card' (rail / featured) or 'hero' (detail). */
  scrim?: 'card' | 'hero' | 'band' | 'portrait' | 'none'
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

const SCRIM: Record<NonNullable<RoleCoverProps['scrim']>, string> = {
  card: 'linear-gradient(180deg, rgba(15,15,20,0) 25%, rgba(15,15,20,0.13) 50%, rgba(15,15,20,0.45) 62.5%, rgba(15,15,20,0.77) 75%, rgba(15,15,20,0.9) 100%)',
  hero: 'linear-gradient(180deg, rgba(15,15,20,0) 35%, rgba(15,15,20,0.14) 56.7%, rgba(15,15,20,0.46) 67.5%, rgba(15,15,20,0.78) 78.3%, rgba(15,15,20,0.92) 100%), linear-gradient(180deg, rgba(15,15,20,0.45) 0%, rgba(15,15,20,0) 22%)',
  band: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)',
  portrait: 'linear-gradient(180deg, rgba(15,15,20,0.4) 0%, rgba(15,15,20,0) 25%, rgba(15,15,20,0) 55%, rgba(15,15,20,0.85) 100%)',
  none: '',
}

// Crest watermark (ruling 2026-10-20): crests are uploaded as JPEG/PNG on a
// white square, and the old luminosity blend kept that square as a pale,
// hard-edged tile over the cover. `multiply` makes white disappear into the
// club gradient and keeps the crest's own colours as a deeper tint; the
// radial mask feathers the square's edges so what remains reads as a mark,
// not a pasted image. The hero sits lower so the crest is not cut by the top.
const WATERMARK_MASK = 'radial-gradient(closest-side, #000 58%, rgba(0,0,0,0.6) 76%, transparent 100%)'
const WATERMARK: Record<NonNullable<RoleCoverProps['scrim']>, CSSProperties> = {
  card: { right: '-10%', top: '-2%', width: '70%' },
  hero: { right: '-6%', top: '8%', width: '64%' },
  band: { right: '-8%', top: '-30%', width: '60%' },
  portrait: { right: '-10%', top: '-2%', width: '70%' },
  none: { right: '-10%', top: '-2%', width: '70%' },
}

/**
 * Cover fallback ladder (Figma "Cover fallback ladder" 157:426, ruling 5):
 * the role's photo → a generated cover in the CLUB's crest colours (gradient
 * + glow + the crest as a rotated luminosity watermark) → Hockia violet when
 * there is no crest. Never a grey placeholder. The category colour never
 * tints a cover. White text always reads: the bottom scrim is on top.
 */
export function RoleCover({ coverUrl, crestUrl, palette, scrim = 'card', className, style, children }: RoleCoverProps) {
  const photo = coverUrl ? getImageUrl(coverUrl, 'feed-full') ?? coverUrl : null
  const crest = !photo && crestUrl ? getImageUrl(crestUrl, 'avatar-xl') ?? crestUrl : null
  return (
    <div className={`relative overflow-hidden ${className ?? ''}`} style={{ background: photo ? '#0f0f14' : coverBackground(palette), ...style }} data-testid="role-cover" data-cover={photo ? 'photo' : palette ? 'crest' : 'fallback'}>
      {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />}
      {crest && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ ...WATERMARK[scrim], aspectRatio: '1', backgroundImage: `url("${crest}")`, backgroundPosition: 'center', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', opacity: 0.55, mixBlendMode: 'multiply', transform: 'rotate(-8deg)', WebkitMaskImage: WATERMARK_MASK, maskImage: WATERMARK_MASK }}
        />
      )}
      {scrim !== 'none' && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: SCRIM[scrim] }} />}
      {children}
    </div>
  )
}

/** Glass chip over a cover (Figma: black 35 % + blur 10, 1 px white 20 % border, inner highlight). */
export function GlassChip({ children, className, dotClass, testId }: { children: ReactNode; className?: string; dotClass?: string; testId?: string }) {
  return (
    <span className={`relative inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-[5px] text-caption font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px] ${className ?? ''}`} style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} data-testid={testId}>
      {dotClass && <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${dotClass}`} />}
      {children}
    </span>
  )
}

/** Crest tile (Figma: white tile r14/r12/r10 with the crest inset); initials when there is no crest. */
export function CrestTile({ src, name, size, radius, className }: { src: string | null; name: string; size: number; radius: number; className?: string }) {
  const url = src ? getImageUrl(src, size > 40 ? 'avatar-md' : 'avatar-sm') ?? src : null
  const pad = Math.round(size * 0.09)
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${className ?? ''}`} style={{ width: size, height: size, borderRadius: radius, boxShadow: 'inset 0 0 0 0.5px rgba(15,15,20,0.08)' }} aria-hidden="true">
      {url
        ? <img src={url} alt="" className="h-full w-full object-contain" style={{ padding: pad }} loading="lazy" decoding="async" />
        : <span className="text-secondary font-semibold text-ink-2">{name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}</span>}
    </span>
  )
}
