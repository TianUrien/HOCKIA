import { useState } from 'react'
import { LogoTile } from './LogoTile'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { getImageUrl, getImageSrcSet } from '@/lib/imageUrl'
import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { CARD_SCRIM, HAIRLINE_ON_PHOTO, PRESS, cardPlaceLine, cardRoleLine, initialsOf, roleGradient, type CardMember } from '@/lib/communityCard'
import pitchVertical from '@/assets/community/pitch-full-vertical.svg'
import monogramRing from '@/assets/community/monogram-ring.svg'
import { FitBadge } from '@/components/ui/FitBadge'
import { NationalityLine } from '@/components/ui/NationalityBadges'
import type { NationalityCountry } from '@/lib/nationality'
import { useBrandOfferCount } from '@/components/offers/OffersWhereYouLive'

/**
 * Card / Member photo (Figma 6:100), Community grid on the phone. 3:4, radius
 * 20; the photo fills the card and a scrim keeps the white text readable on
 * any photo. Info bottom-left: name (one line), role · team, age · flag city.
 * No status chip on people (founder ruling 2026-10-11 — it covered faces).
 * Line 3 on people = nationality flags (+ EU) · age · city (16 Oct 2026):
 * a person's flag means nationality, never where they live.
 * No photo → the role colour, pitch lines and an initials ring. Brands show
 * their logo on a white tile instead of initials. The whole card opens the
 * member preview; the fit pill appears only for recruiters (fit passed in).
 */
interface MemberPhotoCardProps {
  member: CardMember
  /** Best photo for the card (gallery highlight → avatar), or null. */
  photoUrl: string | null
  /** Photos still loading: hold a neutral surface instead of flashing the
   *  no-photo colours (or the avatar) before the gallery photo lands. */
  pending?: boolean
  age?: number | null
  /** City only, no flag ("Buenos Aires"): where the member is based. */
  place?: string | null
  /** The member's nationalities (up to two): the flags on line 3 and the EU badge. */
  nationalities?: NationalityCountry[]
  fit?: FitState | null
  onOpen: () => void
  priority?: boolean
}

const SCRIM = CARD_SCRIM

export function MemberPhotoCard({ member, photoUrl, pending = false, age, place = null, nationalities = [], fit = null, onOpen, priority = false }: MemberPhotoCardProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const name = member.full_name?.trim() || 'HOCKIA member'
  const isBrand = member.role === 'brand'
  // Offers this member can see from the brand (Figma 08 · Brands P2 BT1); 0 outside the Brands tab.
  const offerCount = useBrandOfferCount(member.id)
  const brandLogo = isBrand ? member.brand_logo_url ?? member.avatar_url : null
  const src = !isBrand && photoUrl && failed !== photoUrl ? photoUrl : null
  const roleLine = cardRoleLine(member)
  const placeLine = cardPlaceLine(age, place)
  const fitLabel = fitChipLabel(fit)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={[name, roleLine, placeLine, fitLabel].filter(Boolean).join(', ') + '. Tap to preview.'}
      data-testid="member-tile"
      className={`${pending ? 'bg-line ' : ''}relative flex aspect-[3/4] w-full flex-col justify-end overflow-hidden rounded-[20px] px-3 pb-3 pt-2.5 text-left ${PRESS} focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus-visible:ring-offset-2`}
      style={src ? undefined : { backgroundImage: pending ? SCRIM : `${SCRIM}, ${roleGradient(member.role)}` }}
    >
      {pending ? null : src ? (
        <span aria-hidden="true" className="absolute inset-0">
          <SmoothImage
            src={getImageUrl(src, 'gallery') ?? src}
            srcSet={getImageSrcSet(src, 'gallery') ?? undefined}
            sizes="(max-width: 640px) 50vw, 240px"
            alt=""
            priority={priority}
            className="object-cover"
            onError={() => setFailed(src)}
          />
          <span className="absolute inset-0" style={{ backgroundImage: SCRIM }} />
        </span>
      ) : (
        <span aria-hidden="true" className="absolute inset-0">
          <img src={pitchVertical} alt="" width={174} height={230.229} className="absolute inset-0 h-full w-full" />
          <span className="absolute left-1/2 top-[21.5%] flex h-[88px] w-[88px] -translate-x-1/2 items-center justify-center">
            {brandLogo ? (
              <LogoTile src={getImageUrl(brandLogo, 'avatar-md') ?? brandLogo} name={name} eager={priority} className="h-[88px] w-[88px] rounded-[20px] p-2.5" initialsClassName="text-[28px]" />
            ) : (
              <>
                <img src={monogramRing} alt="" width={88} height={88} className="absolute inset-0" />
                <span className="relative text-[34px] font-bold leading-[48px] text-white/90">{initialsOf(name)}</span>
              </>
            )}
          </span>
        </span>
      )}

      {/* 0.5 pt inside hairline (finish pass) — above the photo, below the text. */}
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-[20px] ${HAIRLINE_ON_PHOTO}`} />
      {isBrand && offerCount > 0 && (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-brand-soft px-2.5 py-1 text-caption font-semibold text-brand-primary" data-testid="brand-offer-count">
          {offerCount} {offerCount === 1 ? 'offer' : 'offers'}
        </span>
      )}
      <span className="relative flex w-full min-w-0 flex-col gap-0.5">
        {fitLabel && fit && (
          <span className="mb-1">
            <FitBadge state={fit} surface="photo" />
          </span>
        )}
        <span className="truncate text-[16px] font-semibold leading-5 text-white">{name}</span>
        {roleLine && <span className="truncate text-[13px] font-medium leading-[17px] text-white/[0.86]">{roleLine}</span>}
        {/* Line 3 (Figma 189:12): nationality flags + EU, then "age · city" with no flag. Clubs/brands keep the place line. */}
        {nationalities.length > 0
          ? <NationalityLine nationalities={nationalities} tail={placeLine} className="pt-0.5" />
          : placeLine && <span className="truncate text-[12px] leading-4 text-white/[0.72]">{placeLine}</span>}
      </span>
    </button>
  )
}
