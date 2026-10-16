import { useEffect, useState, type ReactNode } from 'react'
import { Camera, Instagram, Settings, Share } from 'lucide-react'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { GLASS, initialsOf, roleGradient, type CommunityRole } from '@/lib/communityCard'
import { BlurImage } from '@/components/home/v1/BlurImage'
import { NationalityPills } from '@/components/ui/NationalityBadges'
import type { NationalityCountry } from '@/lib/nationality'
import { cn } from '@/lib/utils'
import { BackGlyph } from '@/components/ui/BackGlyph'

/**
 * Profile v2 hero (Figma PR1 97:5 / PR2): the best photo full-bleed (540 pt),
 * a top shade + eased bottom scrim, photo progress (tap the left / right third
 * = previous / next), glass 44 buttons, and the identity over the photo —
 * name + age, role line, flag + city, Instagram. Continuous with the
 * Community preview. No photo → the role gradient (owner gets the dashed
 * photo target from the strength card instead).
 */
export interface ProfileHeroProps {
  photos: string[]
  name: string
  age?: number | null
  roleLine: string | null
  /** "🇬🇧 London" — base city + flag only (ruling 11 Oct). */
  /** Where the member is based. People pass it as text without a flag ('Based in Santander, Spain'); clubs keep '🇪🇸 Santander'. */
  place: string | null
  /** People: the nationality pills (flag + name) and the EU badge under the role line. */
  nationalities?: NationalityCountry[]
  instagram?: string | null
  role: CommunityRole
  owner: boolean
  /** Recruiters only: STRONG / POSSIBLE FIT pill above the name. */
  fitPill?: { label: string; tone: 'green' | 'yellow' } | null
  onBack?: () => void
  onShare: () => void
  /** Public: the ⋯ menu (report / block), rendered by the host. */
  moreMenu?: ReactNode
  onCamera?: () => void
  onSettings?: () => void
  /** Glass pill above the name, e.g. "Recruiting players" (coach_recruits_for_team). */
  badge?: string | null
  /** Owner with a gap in the role line: "Add your umpire level →" opens the editor. */
  roleLineAction?: (() => void) | null
}

const SCRIM =
  'linear-gradient(180deg, rgba(15,15,20,0) 45%, rgba(15,15,20,0.016) 54.2%, rgba(15,15,20,0.13) 63.3%, rgba(15,15,20,0.44) 72.5%, rgba(15,15,20,0.75) 81.7%, rgba(15,15,20,0.864) 90.8%, rgba(15,15,20,0.88) 100%), linear-gradient(180deg, rgba(15,15,20,0.45) 0%, rgba(15,15,20,0) 22%)'

const GLASS_BTN = cn('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white', GLASS)

export function ProfileHero({ photos, name, age, roleLine, place, nationalities = [], instagram, role, owner, fitPill, onBack, onShare, moreMenu, onCamera, onSettings, badge, roleLineAction }: ProfileHeroProps) {
  const [index, setIndex] = useState(0)
  const count = photos.length
  useEffect(() => { if (index >= count) setIndex(0) }, [count, index])

  // Preload the neighbours so a tap never waits on the network.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const url = photos[(i + count) % count]
      if (url && count > 1) { const img = new Image(); img.src = getImageUrl(url, 'lightbox') ?? url }
    }
  }, [index, photos, count])

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (count < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 1 / 3) setIndex((i) => (i - 1 + count) % count)
    else if (x > 2 / 3) setIndex((i) => (i + 1) % count)
  }

  const current = photos[index] ?? null
  return (
    <section className="relative h-[540px] w-full overflow-hidden bg-ink-1 lg:h-[min(480px,max(400px,calc(100dvh-200px)))] xl:h-[min(640px,max(400px,calc(100dvh-200px)))]" data-testid="profile-hero" style={current ? undefined : { backgroundImage: roleGradient(role) }}>
      {current && (
        <div className="absolute inset-0" onClick={tap} aria-hidden="true">
          <BlurImage key={current} src={getImageUrl(current, 'lightbox') ?? current} lqip={getLqipUrl(current)} eager className="h-full w-full" />
        </div>
      )}
      {!current && !owner && (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[88px] font-bold text-white/25">{initialsOf(name)}</span>
      )}
      {!current && owner && (
        // PR25: a new profile gets the dashed photo target in the hero itself.
        <button type="button" onClick={onCamera} className="absolute left-1/2 top-[34%] z-10 flex h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-white/50 bg-white/10 text-[13px] font-semibold text-white" data-testid="profile-hero-add-photos">
          <Camera className="h-6 w-6" strokeWidth={1.6} /> Add photos
        </button>
      )}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: SCRIM }} aria-hidden="true" />

      <div className="absolute inset-x-4 top-[max(env(safe-area-inset-top),12px)] flex items-center justify-between pt-1">
        {owner ? (
          <button type="button" onClick={onCamera} aria-label="Change photos" className={GLASS_BTN}><Camera className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
        ) : (
          <button type="button" onClick={onBack} aria-label="Back" className={cn(GLASS_BTN, 'lg:invisible')}><BackGlyph className="h-[22px] w-[22px]" strokeWidth={1.8} /></button>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onShare} aria-label="Share profile" className={GLASS_BTN}><Share className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
          {owner
            ? <button type="button" onClick={onSettings} aria-label="Settings" className={GLASS_BTN}><Settings className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
            : moreMenu}
        </div>
      </div>

      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-4 top-[calc(max(env(safe-area-inset-top),12px)+56px)] flex gap-1" aria-label={`Photo ${index + 1} of ${count}`}>
          {photos.map((p, i) => (
            <span key={p} className={cn('h-[3px] flex-1 rounded-[2px] transition-colors duration-150', i === index ? 'bg-white' : 'bg-white/40')} />
          ))}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-4 bottom-6 flex flex-col gap-1.5">
        {badge && (
          <span className={cn('mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] px-2.5 py-[5px] text-caption font-semibold text-white', GLASS)} data-testid="profile-hero-badge">
            <span className="h-[7px] w-[7px] rounded-full bg-[#a78bfa]" aria-hidden="true" /> {badge}
          </span>
        )}
        {fitPill && (
          <span className={cn('mb-1 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.02em] text-white', fitPill.tone === 'green' ? 'bg-[#15803d]' : 'bg-[#b45309]')} data-testid="profile-fit-pill">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" /> {fitPill.label}
          </span>
        )}
        <h1 className="text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-white" data-testid="profile-hero-name">
          {name}{typeof age === 'number' ? `, ${age}` : ''}
        </h1>
        {roleLineAction ? (
          <button type="button" onClick={roleLineAction} className="pointer-events-auto w-fit truncate text-left text-[15px] leading-5 text-white/90">{roleLine} →</button>
        ) : roleLine && <p className="truncate text-[15px] leading-5 text-white/90">{roleLine}</p>}
        {nationalities.length > 0 && <NationalityPills nationalities={nationalities} className="pointer-events-auto pt-0.5" />}
        {(place || instagram) && (
          <div className="flex items-center gap-2.5">
            {place && <p className="truncate text-secondary text-white/85">{place}</p>}
            {instagram && (
              <a
                href={`https://instagram.com/${instagram}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('pointer-events-auto inline-flex items-center gap-1 rounded-full bg-[rgba(15,15,20,0.35)] px-2 py-[3px] text-caption text-white', GLASS)}
              >
                <Instagram className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" /> {instagram}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
