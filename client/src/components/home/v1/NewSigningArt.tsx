import { useState } from 'react'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from './BlurImage'
import { cn } from '@/lib/utils'
import { SquircleBox } from './primitives'
import pitchLines from '@/assets/home/signing-pitch-lines.svg'
import confetti from '@/assets/home/signing-confetti.svg'
import RolePlaceholder from '@/components/RolePlaceholder'

/**
 * The New signing card — option E, FINAL (Figma 60:194; spec 65:329):
 * surface/subtle, full pitch lines at 12 % brand, light confetti that never
 * sits over faces or text, "NEW SIGNING" 34 heavy, the person's photo and the
 * club's crest as two overlapping 140 pt circles (6 pt white ring, soft
 * shadow), then "Name × Club" and "role · team · year".
 * No photo → initials; no crest → the club's monogram. Used by the feed,
 * the composer preview (H11b) and the "Post this signing?" sheet (H14).
 */
export interface SigningArtProps {
  personName: string
  personAvatarUrl: string | null
  clubName: string
  clubCrestUrl: string | null
  /** "Defender · Women's 1st team · 2027" — already joined by the caller. */
  detail: string | null
  className?: string
}

const CIRCLE = 'absolute top-0 h-[140px] w-[140px] overflow-hidden rounded-full bg-white ring-[6px] ring-white shadow-[0_8px_24px_rgba(15,15,20,0.12),0_1px_3px_rgba(15,15,20,0.08)]'

// No photo / crest: Avatar / Placeholder (never initials, founder 2026-10-26).
function Initials({ role, className }: { name: string; role: 'player' | 'club'; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('block h-full w-full', className)}>
      <RolePlaceholder role={role} label="" />
    </span>
  )
}

export function NewSigningArt({ personName, personAvatarUrl, clubName, clubCrestUrl, detail, className }: SigningArtProps) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const [crestFailed, setCrestFailed] = useState(false)
  const photo = personAvatarUrl && !photoFailed ? getImageUrl(personAvatarUrl, 'avatar-lg') : null
  const crest = clubCrestUrl && !crestFailed ? getImageUrl(clubCrestUrl, 'avatar-lg') : null

  return (
    <SquircleBox
      className={cn('relative flex flex-col items-center gap-5 overflow-hidden bg-surface-subtle px-5 py-7 shadow-[inset_0_0_0_0.5px_rgba(15,15,20,0.06)]', className)}
    >
      <img src={pitchLines} alt="" aria-hidden="true" className="pointer-events-none absolute left-0 top-[76px] h-[196px] w-full" />
      <img src={confetti} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />

      <p className="relative whitespace-nowrap text-[34px] font-black leading-[41px] tracking-[1.7px] text-ink-1">NEW SIGNING</p>

      <div className="relative h-[140px] w-[260px]" role="img" aria-label={`${personName} and ${clubName}`}>
        <span className={cn(CIRCLE, 'left-0')}>
          {photo ? (
            <BlurImage src={photo} lqip={getLqipUrl(personAvatarUrl)} eager className="h-full w-full" onError={() => setPhotoFailed(true)} />
          ) : (
            <Initials name={personName} role="player" />
          )}
        </span>
        <span className={cn(CIRCLE, 'left-[120px] flex items-center justify-center')}>
          {crest ? (
            <img src={crest} alt="" className="h-[96px] w-[96px] object-contain" decoding="async" onError={() => setCrestFailed(true)} />
          ) : (
            <Initials name={clubName} role="club" />
          )}
        </span>
      </div>

      <div className="relative flex max-w-full flex-col items-center gap-1 text-center">
        <p className="max-w-full truncate text-body font-semibold text-ink-1">
          {personName} × {clubName}
        </p>
        {detail && <p className="max-w-full truncate text-secondary text-ink-2">{detail}</p>}
      </div>
    </SquircleBox>
  )
}
