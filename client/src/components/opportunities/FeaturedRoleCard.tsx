import type { Vacancy } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { categoryFamily, genderPill, isPaid, roleBenefits, roleHeadline, whenLine, CATEGORY_DOT_ON_PHOTO_CLASSES } from '@/lib/opportunityCopy'
import { HOCKIA_FALLBACK } from '@/lib/crestPalette'
import { roleStatus } from '@/lib/opportunityRails'
import { usePressSpring } from '@/hooks/usePressSpring'
import { useRolePrefetch } from '@/hooks/useRolePrefetch'

export interface FeaturedRoleCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  countryFlag: string | null
  league: string | null
  palette: CrestPalette | null | undefined
  onOpen: () => void
  now?: Date
  /** 'wide' = desktop D1 (Figma 192:804): 400 pt, text top-left, club strip at the bottom. */
  layout?: 'phone' | 'wide'
}

/**
 * Featured card (Figma O1 147:283, App Store "Today" style): 440 pt, r28,
 * the role's cover (photo or generated from the club's crest colours), an
 * eyebrow "FEATURED ROLE · CLOSES IN 9 DAYS", the title, the club row and glass
 * chips. No button on the card: the whole card is the one tap target (audit A5).
 */
export function FeaturedRoleCard({ vacancy, clubName, clubLogo, countryFlag, league, palette, onOpen, now, layout = 'phone' }: FeaturedRoleCardProps) {
  const press = usePressSpring<HTMLButtonElement>()
  const prefetch = useRolePrefetch(vacancy.id, press.ref)
  const headline = roleHeadline(vacancy)
  const pill = genderPill(vacancy.gender)
  const family = categoryFamily(vacancy.gender)
  const status = roleStatus(vacancy, now)
  const city = vacancy.location_city?.trim() || vacancy.location_country?.trim() || ''
  const place = [countryFlag && city ? `${countryFlag} ${city}` : city, league].filter(Boolean).join(' · ')
  const chips = [...(isPaid(vacancy) ? ['€ Paid'] : []), ...roleBenefits(vacancy).map((b) => b.label)].slice(0, 2)
  const eyebrow = ['FEATURED ROLE', status && status.label !== 'New' ? status.label.toUpperCase() : null].filter(Boolean).join(' · ')

  if (layout === 'wide') {
    const stripColor = withAlpha((palette ?? HOCKIA_FALLBACK).stops[2], 0.62)
    const wideChips = [...(isPaid(vacancy) ? ['€ Paid'] : []), ...roleBenefits(vacancy).map((b) => b.label)].slice(0, 2)
    return (
      <button
        ref={press.ref}
        type="button"
        onClick={onOpen}
        {...press.handlers}
        {...prefetch.handlers}
        className="group block w-full text-left transition-transform duration-200 [transform-origin:center] [will-change:transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
        aria-label={`Featured role: ${headline.title} at ${clubName}`}
        data-testid="featured-role"
      >
        <RoleCover coverUrl={vacancy.cover_url} crestUrl={clubLogo} palette={palette} scrim="none" className="h-[400px] rounded-[28px] shadow-[0_12px_30px_rgba(0,0,0,0.12)] transition-shadow duration-200 group-hover:shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
          <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(180deg, rgba(15,15,20,0.35) 0%, rgba(15,15,20,0) 55%)' }} />
          <div className="absolute left-12 top-14 flex max-w-[620px] flex-col gap-3">
            <span className="text-caption font-semibold tracking-[0.04em] text-white/85">{eyebrow}</span>
            <h2 className="line-clamp-2 text-[34px] font-bold leading-[41px] tracking-[-0.015em] text-white">{headline.title}</h2>
            <div className="flex flex-wrap gap-2">
              {pill && family && <GlassChip dotClass={CATEGORY_DOT_ON_PHOTO_CLASSES[family]}>{pill.label}</GlassChip>}
              {wideChips.map((c) => <GlassChip key={c}>{c}</GlassChip>)}
              <GlassChip>{whenLine(vacancy)}</GlassChip>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-24 items-center gap-3.5 pl-12 pr-8 backdrop-blur-[12px]" style={{ backgroundColor: stripColor }} data-testid="featured-club-strip">
            <CrestTile src={clubLogo} name={clubName} size={52} radius={14} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold leading-[22px] text-white">{clubName}</span>
              {place && <span className="block truncate text-secondary text-white/75">{place}</span>}
            </span>
          </div>
        </RoleCover>
      </button>
    )
  }

  return (
    <button
      ref={press.ref}
      type="button"
      onClick={onOpen}
      {...press.handlers}
      {...prefetch.handlers}
      className="block w-full text-left [transform-origin:center] [will-change:transform]"
      aria-label={`Featured role: ${headline.title} at ${clubName}`}
      data-testid="featured-role"
    >
      <RoleCover coverUrl={vacancy.cover_url} crestUrl={clubLogo} palette={palette} scrim="hero" className="h-[440px] rounded-[28px] shadow-[0_16px_40px_rgba(15,15,20,0.14),0_2px_4px_rgba(15,15,20,0.06)]">
        <span className="absolute left-5 top-5 text-caption font-semibold tracking-[0.04em] text-white/85">{eyebrow}</span>
        <div className="absolute inset-x-5 bottom-5 flex flex-col gap-3">
          <h2 className="line-clamp-3 text-title-xl text-white">{headline.title}</h2>
          <div className="flex items-center gap-2.5">
            <CrestTile src={clubLogo} name={clubName} size={40} radius={12} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold leading-[21px] text-white">{clubName}</span>
              {place && <span className="block truncate text-secondary text-white/80">{place}</span>}
            </span>
          </div>
          {(pill || chips.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {pill && family && <GlassChip dotClass={CATEGORY_DOT_ON_PHOTO_CLASSES[family]}>{pill.label}</GlassChip>}
              {chips.map((c) => <GlassChip key={c}>{c}</GlassChip>)}
            </div>
          )}
        </div>
      </RoleCover>
    </button>
  )
}

/** `#rrggbb` → `rgba(r,g,b,a)` for the translucent club strip (stop2 at 62 %, Figma 192:819). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(15,15,20,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}
