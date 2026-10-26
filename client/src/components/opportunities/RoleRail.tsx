import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { Vacancy } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { categoryFamily, genderPill, roleHeadline, CATEGORY_DOT_ON_PHOTO_CLASSES } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'
import { usePressSpring } from '@/hooks/usePressSpring'
import { useRolePrefetch } from '@/hooks/useRolePrefetch'

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

/**
 * Desktop rail (Figma D1 192:827): the same title block, "See all" and a
 * ‹ › pager over a 4-up grid (3-up at 1024–1199). The cards are RailCard
 * with `fluid`, so they fill their column.
 */
export function RoleRailDesktop({ title, subtitle, onSeeAll, cards, testId }: { title: string; subtitle: string; onSeeAll?: () => void; cards: ReactNode[]; testId?: string }) {
  const fourUp = useMediaQuery('(min-width: 1200px)')
  const perPage = fourUp ? 4 : 3
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(cards.length / perPage))
  const current = Math.min(page, pages - 1)
  const shown = cards.slice(current * perPage, current * perPage + perPage)
  const pagerButton = 'flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-ink-1 transition-colors hover:bg-surface-muted disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface-subtle'
  return (
    <section data-testid={testId ?? 'role-rail'} data-page={current + 1} data-pages={pages}>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title text-ink-1">{title}</h2>
          <p className="text-secondary text-ink-2">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} className="mr-1 text-[14px] font-semibold leading-[19px] text-brand-primary hover:underline">See all</button>
          )}
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous opportunities" className={pagerButton}><ChevronLeft className="h-4 w-4" strokeWidth={2.2} /></button>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="More opportunities" className={pagerButton}><ChevronRight className="h-4 w-4" strokeWidth={2.2} /></button>
        </div>
      </div>
      <div className="mt-3.5 grid gap-4" style={{ gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }}>
        {shown}
      </div>
    </section>
  )
}

export function RailCard({ data, countryName, onOpen, fluid = false }: { data: RailCardData; countryName: string | null; onOpen: () => void; /** Fill the grid column (desktop) instead of the 272 pt phone width. */ fluid?: boolean }) {
  const press = usePressSpring<HTMLButtonElement>()
  const prefetch = useRolePrefetch(data.vacancy.id, press.ref)
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
      {...prefetch.handlers}
      className={`${fluid ? 'group block w-full transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50' : 'shrink-0 snap-start'} text-left [transform-origin:center] [will-change:transform]`}
      aria-label={`${lead} at ${clubName}`}
      data-testid="rail-card"
    >
      <RoleCover coverUrl={vacancy.cover_url} crestUrl={clubLogo} palette={palette} scrim="card" className={`h-[200px] rounded-[22px] shadow-[0_8px_20px_rgba(15,15,20,0.1)] ${fluid ? 'w-full transition-shadow duration-200 group-hover:shadow-[0_14px_28px_rgba(15,15,20,0.16)]' : 'w-[272px]'}`}>
        {pill && family && <span className="absolute left-3 top-3"><GlassChip dotClass={CATEGORY_DOT_ON_PHOTO_CLASSES[family]}>{pill.label}</GlassChip></span>}
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
