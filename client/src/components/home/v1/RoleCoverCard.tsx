import { useState, type ReactNode } from 'react'
import { useMemberPhotos } from '@/hooks/useMemberPhotos'
import { getImageUrl } from '@/lib/imageUrl'
import { CARD_SCRIM, CLUB_BRAND_GRADIENT, HAIRLINE_ON_PHOTO, PRESS } from '@/lib/communityCard'
import { LogoTile } from '@/components/community/photo/LogoTile'
import { cn } from '@/lib/utils'
import { GlassChip, SquircleBox } from './primitives'

/**
 * A role on a photo (Figma 60:300 role card 220×150 r20, 60:381 opportunity
 * card 361×236 r24): the club's best gallery photo (≥600 px, else the brand
 * gradient), an eased 7-stop scrim, the crest, then position and club · flag.
 * Shared by "Roles for you" and the feed's opportunity card.
 */
interface RoleCoverCardProps {
  clubId: string | null
  clubName: string
  crestUrl: string | null
  title: string
  subtitle: string
  size: 'rail' | 'feed'
  chip?: string
  cta?: ReactNode
  onOpen: () => void
}

export function RoleCoverCard({ clubId, clubName, crestUrl, title, subtitle, size, chip, cta, onOpen }: RoleCoverCardProps) {
  const photos = useMemberPhotos(clubId)
  const [small, setSmall] = useState<ReadonlySet<string>>(new Set())
  const cover = (photos.data ?? []).find((u) => !small.has(u)) ?? null
  const feed = size === 'feed'

  return (
    <SquircleBox
      radius={feed ? 24 : 20}
      className={cn('relative shrink-0 overflow-hidden bg-ink-1', HAIRLINE_ON_PHOTO, PRESS, feed ? 'h-[236px] w-full' : 'h-[150px] w-[220px]')}
      style={cover ? undefined : { backgroundImage: CLUB_BRAND_GRADIENT }}
    >
      <button type="button" onClick={onOpen} aria-label={`${title}, ${clubName}`} className="absolute inset-0 text-left">
        {cover && (
          <img
            src={getImageUrl(cover, 'feed-full') ?? cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            // Spec (Community 26:1020): a cover is at least 600 px wide.
            onLoad={(e) => { if (e.currentTarget.naturalWidth < 600) setSmall((p) => new Set(p).add(cover)) }}
            onError={() => setSmall((p) => new Set(p).add(cover))}
          />
        )}
        <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: CARD_SCRIM }} />
      </button>
      {chip && <GlassChip className={cn('absolute', feed ? 'left-4 top-4' : 'left-3 top-3')}>{chip}</GlassChip>}
      <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex', feed ? 'items-center gap-3 p-4' : 'flex-col items-start gap-1 px-3 pb-3')}>
        {crestUrl ? (
          <LogoTile src={crestUrl} name={clubName} className={cn('shrink-0 rounded-full p-1', feed ? 'h-11 w-11' : 'h-8 w-8')} initialsClassName="text-[11px]" />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-white">{title}</span>
          <span className={cn('block truncate text-white/80', feed ? 'text-secondary' : 'text-caption')}>{subtitle}</span>
        </span>
        {cta && <span className="pointer-events-auto">{cta}</span>}
      </div>
    </SquircleBox>
  )
}
