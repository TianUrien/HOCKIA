import { useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { MIN_COVER_WIDTH } from '@/lib/coverQuality'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { getImageUrl, getImageSrcSet } from '@/lib/imageUrl'
import { CLUB_BRAND_GRADIENT, CLUB_COVER_SCRIM, GLASS, HAIRLINE_ON_PHOTO, LIGHT_SHADOW, PRESS, clubCover, crestGradient } from '@/lib/communityCard'
import { useSquircle } from '@/lib/squircle'
import pitchHorizontal from '@/assets/community/pitch-full-horizontal.svg'
import recruitingDot from '@/assets/community/recruiting-dot.svg'
import { LogoTile } from './LogoTile'
import RolePlaceholder from '@/components/RolePlaceholder'

/**
 * Card / Club wide (Figma 12:41): clubs always span both columns (founder
 * ruling 2026-10-11). Full width × 196, radius 24.
 *  - Cover=Photo: the club's cover photo, purple scrim, white crest tile 44.
 *  - Cover=Crest: no cover → the crest's colour as a gradient, faint pitch
 *    lines and the crest large and crisp at the top right.
 *  - Cover=None: no crest either → brand gradient + a 96 monogram.
 * "Recruiting now" (glass chip) only while the club has an open role.
 */
interface ClubWideCardProps {
  name: string
  meta: string
  coverUrl: string | null
  crestUrl: string | null
  /** Stored dominant crest colour ("#RRGGBB"); brand gradient until known. */
  crestColor?: string | null
  recruiting: boolean
  onOpen: () => void
  priority?: boolean
}

/** Spec: the cover is the best photo at least 600 px wide (Figma Community 26:1020). */

export function ClubWideCard({ name, meta, coverUrl, crestUrl, crestColor = null, recruiting, onOpen, priority = false }: ClubWideCardProps) {
  const [coverFailed, setCoverFailed] = useState(false)
  const [crestFailed, setCrestFailed] = useState(false)
  const crest = crestUrl && !crestFailed ? crestUrl : null
  const cover = clubCover(coverUrl && !coverFailed ? coverUrl : null, crest)
  const crestSrc = crest ? getImageUrl(crest, 'avatar-lg') ?? crest : null
  // Continuous corners on this large surface (finish pass, spec 26:1046).
  const ref = useRef<HTMLButtonElement>(null)
  useSquircle(ref, 24)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}, ${meta}. Tap to preview.`}
      data-testid="member-tile"
      ref={ref}
      className={`relative flex h-[196px] w-full flex-col justify-end gap-1 overflow-hidden rounded-[24px] px-4 pb-4 text-left ${PRESS} focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus-visible:ring-offset-2`}
      style={cover === 'photo' ? undefined : { backgroundImage: cover === 'crest' ? crestGradient(crestColor) : CLUB_BRAND_GRADIENT }}
    >
      {cover === 'photo' && coverUrl ? (
        <span aria-hidden="true" className="absolute inset-0">
          <SmoothImage
            src={getImageUrl(coverUrl, 'feed-full') ?? coverUrl}
            srcSet={getImageSrcSet(coverUrl, 'feed-full') ?? undefined}
            sizes="100vw"
            alt=""
            priority={priority}
            className="object-cover"
            onError={() => setCoverFailed(true)}
            // A small upload (often the logo saved as media) blows up blurry
            // across the card: below the spec's 600 px it reads as no cover
            // and the card takes the crest variant instead.
            onLoad={(e) => { if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < MIN_COVER_WIDTH) setCoverFailed(true) }}
          />
          <span className="absolute inset-0" style={{ backgroundImage: CLUB_COVER_SCRIM }} />
        </span>
      ) : (
        <span aria-hidden="true" className="absolute inset-0">
          <img src={pitchHorizontal} alt="" width={361} height={196} className="absolute inset-0 h-full w-full" />
          {cover === 'crest' && crestSrc ? (
            // Many crests are JPEGs with a white square around them: a white
            // rounded tile makes that square look intended on the colour.
            <LogoTile
              src={crestSrc}
              name={name}
              eager={priority}
              onError={() => setCrestFailed(true)}
              className={`absolute right-[23px] top-[26px] h-[108px] w-[108px] rounded-[24px] p-2.5 ${LIGHT_SHADOW}`}
              initialsClassName="text-[32px]"
            />
          ) : (
            <span className="absolute right-[29px] top-8 block h-24 w-24 overflow-hidden rounded-full ring-1 ring-white/35">
              <RolePlaceholder role="club" label="" />
            </span>
          )}
        </span>
      )}

      {recruiting && (
        <span className={`absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] py-[5px] pl-2 pr-2.5 ${GLASS}`}>
          <img src={recruitingDot} alt="" width={7} height={7} />
          <span className="text-[12px] font-semibold leading-4 text-white">Recruiting now</span>
        </span>
      )}

      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-[24px] ${HAIRLINE_ON_PHOTO}`} />
      <span className="relative flex w-full items-center gap-3">
        {cover === 'photo' && crestSrc && (
          <LogoTile src={crestSrc} name={name} className="h-11 w-11 shrink-0 rounded-[12px] p-1" initialsClassName="text-[14px]" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold leading-[22px] text-white">{name}</span>
          <span className="truncate text-[13px] leading-[18px] text-white/80">{meta}</span>
        </span>
        <ChevronRight aria-hidden="true" className="h-[22px] w-[22px] shrink-0 text-white" strokeWidth={2} />
      </span>
    </button>
  )
}
