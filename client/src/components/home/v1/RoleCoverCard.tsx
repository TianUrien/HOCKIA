import { useMemo, useState, type ReactNode } from 'react'
import { useMemberPhotos } from '@/hooks/useMemberPhotos'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from './BlurImage'
import { CARD_SCRIM, CLUB_BRAND_GRADIENT, HAIRLINE_ON_PHOTO, PRESS, crestGradient } from '@/lib/communityCard'
import { useClubCrestColors } from '@/hooks/useClubCrestColors'
import pitchHorizontal from '@/assets/community/pitch-full-horizontal.svg'
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
  // No cover → the Community club-card rule (26:1046): the crest's colour,
  // faint pitch lines, the crest; brand purple only without a crest colour.
  const crestClubs = useMemo(() => (clubId && crestUrl ? [{ id: clubId, avatar_url: crestUrl }] : []), [clubId, crestUrl])
  const crestColors = useClubCrestColors(crestClubs)
  const crestColor = clubId ? crestColors.get(clubId) ?? null : null
  const background = cover ? undefined : crestColor ? crestGradient(crestColor) : CLUB_BRAND_GRADIENT

  return (
    <SquircleBox
      radius={feed ? 24 : 20}
      className={cn('relative shrink-0 overflow-hidden bg-ink-1', HAIRLINE_ON_PHOTO, PRESS, feed ? 'h-[236px] w-full' : 'h-[150px] w-[220px]')}
      style={background ? { backgroundImage: background } : undefined}
    >
      <button type="button" onClick={onOpen} aria-label={`${title}, ${clubName}`} className="absolute inset-0 text-left">
        {cover && (
          <BlurImage
            src={getImageUrl(cover, 'feed-full') ?? cover}
            lqip={getLqipUrl(cover)}
            color={crestColor}
            className="absolute inset-0 h-full w-full"
            // Spec (Community 26:1020): a cover is at least 600 px wide.
            onLoad={(e) => { if (e.currentTarget.naturalWidth < 600) setSmall((p) => new Set(p).add(cover)) }}
            onError={() => setSmall((p) => new Set(p).add(cover))}
          />
        )}
        {!cover && <img src={pitchHorizontal} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full opacity-60" />}
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
