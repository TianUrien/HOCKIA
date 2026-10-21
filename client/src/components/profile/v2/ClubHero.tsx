import { useEffect, useState, type ReactNode } from 'react'
import { Camera, Settings, Share } from 'lucide-react'
import { useLowResCovers } from '@/hooks/useLowResCovers'
import RolePlaceholder from '@/components/RolePlaceholder'
import pitchHorizontal from '@/assets/community/pitch-full-horizontal.svg'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { GLASS, crestGradient } from '@/lib/communityCard'
import { BlurImage } from '@/components/home/v1/BlurImage'
import VerifiedBadge from '@/components/VerifiedBadge'
import { cn } from '@/lib/utils'
import { BackGlyph } from '@/components/ui/BackGlyph'

/**
 * Club hero (Figma PR6 106:256 / PR7 107:303): the club's cover photos
 * full-bleed (480 pt) with progress bars and tap thirds; no cover → the
 * crest's colour with a faint pitch (Community Cover=Crest). The identity
 * sits over the scrim: crest tile 72 (white r20), name + verified, league
 * line, flag + city · Founded, and the glass "Recruiting now" pill when the
 * club has an open role.
 */
export interface ClubHeroProps {
  photos: string[]
  crestUrl: string | null
  crestColor: string | null
  name: string
  verified?: boolean
  verifiedAt?: string | null
  leagueLine: string | null
  placeLine: string | null
  recruiting: boolean
  owner: boolean
  onBack?: () => void
  onShare: () => void
  moreMenu?: ReactNode
  onEditCover?: () => void
  onEditCrest?: () => void
  onSettings?: () => void
}

const SCRIM =
  'linear-gradient(180deg, rgba(15,15,20,0) 35%, rgba(15,15,20,0.017) 45.8%, rgba(15,15,20,0.133) 56.7%, rgba(15,15,20,0.45) 67.5%, rgba(15,15,20,0.767) 78.3%, rgba(15,15,20,0.883) 89.2%, rgba(15,15,20,0.9) 100%), linear-gradient(180deg, rgba(15,15,20,0.45) 0%, rgba(15,15,20,0) 22%)'

const GLASS_BTN = cn('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white', GLASS)

export function ClubHero(props: ClubHeroProps) {
  const { crestUrl, crestColor, name, owner } = props
  // Low-resolution covers (< 600 px natural width) are dropped: the hero then
  // shows the crest-gradient cover with pitch lines (Batch C).
  const lowRes = useLowResCovers(props.photos, (u) => getImageUrl(u, 'lightbox') ?? u)
  const photos = lowRes.size > 0 ? props.photos.filter((p) => !lowRes.has(p)) : props.photos
  const [index, setIndex] = useState(0)
  const count = photos.length
  useEffect(() => { if (index >= count) setIndex(0) }, [count, index])

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (count < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 1 / 3) setIndex((i) => (i - 1 + count) % count)
    else if (x > 2 / 3) setIndex((i) => (i + 1) % count)
  }

  const current = photos[index] ?? null
  const crest = crestUrl ? getImageUrl(crestUrl, 'avatar-md') ?? crestUrl : null

  return (
    <section className={cn('relative h-[480px] w-full overflow-hidden bg-ink-1', current ? 'lg:h-[min(480px,max(400px,calc(100dvh-200px)))] xl:h-[min(640px,max(400px,calc(100dvh-200px)))]' : 'lg:h-[min(450px,max(400px,calc(100dvh-200px)))] xl:h-[min(600px,max(400px,calc(100dvh-200px)))]')} data-testid="club-hero" style={current ? undefined : { backgroundImage: crestGradient(crestColor) }}>
      {current ? (
        <div className="absolute inset-0" onClick={tap} aria-hidden="true">
          <BlurImage key={current} src={getImageUrl(current, 'lightbox') ?? current} lqip={getLqipUrl(current)} eager className="h-full w-full" />
        </div>
      ) : (
        <img src={pitchHorizontal} alt="" aria-hidden="true" className="absolute inset-x-0 top-[90px] h-[220px] w-full opacity-60" />
      )}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: SCRIM }} aria-hidden="true" />

      <div className="absolute inset-x-4 top-[max(env(safe-area-inset-top),12px)] flex items-center justify-between pt-1">
        {owner ? (
          <button type="button" onClick={props.onEditCover} aria-label="Edit cover photos" className={GLASS_BTN}><Camera className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
        ) : (
          <button type="button" onClick={props.onBack} aria-label="Back" className={cn(GLASS_BTN, 'lg:invisible')}><BackGlyph className="h-[22px] w-[22px]" strokeWidth={1.8} /></button>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={props.onShare} aria-label="Share profile" className={GLASS_BTN}><Share className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
          {owner ? (
            <button type="button" onClick={props.onSettings} aria-label="Settings" className={GLASS_BTN}><Settings className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
          ) : props.moreMenu}
        </div>
      </div>

      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-4 top-[calc(max(env(safe-area-inset-top),12px)+56px)] flex gap-1" aria-hidden="true">
          {photos.map((p, i) => <span key={p} className={cn('h-[3px] flex-1 rounded-[2px]', i === index ? 'bg-white' : 'bg-white/40')} />)}
        </div>
      )}

      <div className="absolute inset-x-4 bottom-6 flex flex-col items-start gap-1.5">
        <div className="relative">
          <div className={cn('flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[20px] shadow-[0_10px_14px_rgba(15,15,20,0.1),0_1px_1px_rgba(15,15,20,0.06)]', crest ? 'bg-white p-2' : '')}>
            {crest ? (
              <img src={crest} alt="" className="h-14 w-14 object-contain" decoding="async" />
            ) : (
              // No crest: violet rounded square + large initials (Batch C).
              <RolePlaceholder role="club" name={name} label="" />
            )}
          </div>
          {owner && (
            <button type="button" onClick={props.onEditCrest} aria-label="Change crest" className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-hockia-primary text-white"><Camera className="h-3.5 w-3.5" strokeWidth={2} /></span>
            </button>
          )}
        </div>
        <div className="flex max-w-full items-center gap-2">
          <h1 className="min-w-0 truncate text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-white" data-testid="club-hero-name">{name}</h1>
          <VerifiedBadge verified={Boolean(props.verified)} verifiedAt={props.verifiedAt ?? null} className="shrink-0 text-white" />
        </div>
        {props.leagueLine && <p className="max-w-full truncate text-[15px] leading-5 text-white/90">{props.leagueLine}</p>}
        {props.placeLine && <p className="max-w-full truncate text-secondary text-white/85">{props.placeLine}</p>}
      </div>

      {props.recruiting && (
        <span className={cn('absolute right-4 bottom-[132px] inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] px-2.5 py-[5px] text-caption font-semibold text-white', GLASS)} data-testid="club-recruiting-pill">
          <span className="h-[7px] w-[7px] rounded-full bg-[#4ade80]" aria-hidden="true" />
          Recruiting now
        </span>
      )}
    </section>
  )
}
