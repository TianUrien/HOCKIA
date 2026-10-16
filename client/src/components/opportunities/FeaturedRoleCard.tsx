import type { Vacancy } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { CATEGORY_DOT_CLASSES, categoryFamily, genderPill, isPaid, roleBenefits, roleHeadline } from '@/lib/opportunityCopy'
import { roleStatus } from '@/lib/opportunityRails'
import { usePressSpring } from '@/hooks/usePressSpring'

export interface FeaturedRoleCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  countryFlag: string | null
  league: string | null
  palette: CrestPalette | null | undefined
  onOpen: () => void
  now?: Date
}

/**
 * Featured card (Figma O1 147:283, App Store "Today" style): 440 pt, r28,
 * the role's cover (photo or generated from the club's crest colours), an
 * eyebrow "FEATURED ROLE · CLOSES IN 9 DAYS", the title, the club row with a
 * white "View" pill, and glass chips. The whole card is one tap target.
 */
export function FeaturedRoleCard({ vacancy, clubName, clubLogo, countryFlag, league, palette, onOpen, now }: FeaturedRoleCardProps) {
  const press = usePressSpring<HTMLButtonElement>()
  const headline = roleHeadline(vacancy)
  const pill = genderPill(vacancy.gender)
  const family = categoryFamily(vacancy.gender)
  const status = roleStatus(vacancy, now)
  const city = vacancy.location_city?.trim() || vacancy.location_country?.trim() || ''
  const place = [countryFlag && city ? `${countryFlag} ${city}` : city, league].filter(Boolean).join(' · ')
  const chips = [...(isPaid(vacancy) ? ['€ Paid'] : []), ...roleBenefits(vacancy).map((b) => b.label)].slice(0, 2)
  const eyebrow = ['FEATURED ROLE', status && status.label !== 'New' ? status.label.toUpperCase() : null].filter(Boolean).join(' · ')

  return (
    <button
      ref={press.ref}
      type="button"
      onClick={onOpen}
      {...press.handlers}
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
            <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-white px-[18px] text-[14px] font-semibold leading-[19px] text-brand-primary">View</span>
          </div>
          {(pill || chips.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {pill && family && <GlassChip dotClass={CATEGORY_DOT_CLASSES[family]}>{pill.label}</GlassChip>}
              {chips.map((c) => <GlassChip key={c}>{c}</GlassChip>)}
            </div>
          )}
        </div>
      </RoleCover>
    </button>
  )
}
