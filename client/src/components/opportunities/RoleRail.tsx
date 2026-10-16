import type { ReactNode } from 'react'
import type { Vacancy } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { CATEGORY_DOT_CLASSES, categoryFamily, genderPill, roleHeadline } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'
import { usePressSpring } from '@/hooks/usePressSpring'

export interface RailCardData {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  palette: CrestPalette | null | undefined
}

/**
 * Rail (Figma O1 147:306): a 22 pt title + 13 pt subtitle, "See all" when
 * the rail maps onto a filter, and a horizontal snap scroller of 272×200
 * cover cards. A rail with fewer than two cards never renders (ruling 3).
 */
export function RoleRail({ title, subtitle, onSeeAll, children, testId }: { title: string; subtitle: string; onSeeAll?: () => void; children: ReactNode; testId?: string }) {
  return (
    <section className="pt-7" data-testid={testId ?? 'role-rail'}>
      <div className="flex items-end gap-3 px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-title text-ink-1">{title}</h2>
          <p className="text-secondary text-ink-2">{subtitle}</p>
        </div>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="shrink-0 text-[14px] font-semibold leading-[19px] text-brand-primary">See all</button>
        )}
      </div>
      <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </section>
  )
}

export function RailCard({ data, countryName, onOpen }: { data: RailCardData; countryName: string | null; onOpen: () => void }) {
  const press = usePressSpring<HTMLButtonElement>()
  const { vacancy, clubName, clubLogo, palette } = data
  const pill = genderPill(vacancy.gender)
  const family = categoryFamily(vacancy.gender)
  const lead = positionLabel(vacancy.position) || roleHeadline(vacancy).title
  const sub = [clubName, countryName].filter(Boolean).join(' · ')
  return (
    <button
      ref={press.ref}
      type="button"
      onClick={onOpen}
      {...press.handlers}
      className="shrink-0 snap-start text-left [transform-origin:center] [will-change:transform]"
      aria-label={`${lead} at ${clubName}`}
      data-testid="rail-card"
    >
      <RoleCover coverUrl={vacancy.cover_url} crestUrl={clubLogo} palette={palette} scrim="card" className="h-[200px] w-[272px] rounded-[22px] shadow-[0_8px_20px_rgba(15,15,20,0.1)]">
        {pill && family && <span className="absolute left-3 top-3"><GlassChip dotClass={CATEGORY_DOT_CLASSES[family]}>{pill.label}</GlassChip></span>}
        <div className="absolute bottom-3.5 left-3.5 right-3.5 flex items-center gap-2.5">
          <CrestTile src={clubLogo} name={clubName} size={36} radius={10} />
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-semibold leading-[21px] text-white">{lead}</span>
            <span className="block truncate text-caption text-white/80">{sub}</span>
          </span>
        </div>
      </RoleCover>
    </button>
  )
}
