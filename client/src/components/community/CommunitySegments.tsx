import { useEffect, useRef } from 'react'
import { chipTone } from '@/components/ui/chipClasses'
import { useLocation, useNavigate } from 'react-router-dom'
import { pathWithSearch, searchQueryOf } from './communityFilters'
import { useCommunityT } from '@/i18n/ns/community'

/**
 * Community role filter chips (Figma Community v2 "role filters"):
 *
 *   All · Players · Coaches · Clubs · Brands · Umpires
 *
 * Each chip is a route, so deep links and back-navigation keep working.
 * Questions left Community on 2026-09-20 — a question is a post kind in the
 * Home feed. Scrolls horizontally on narrow screens and keeps the active
 * chip in view.
 */
export type CommunityTab = 'all' | 'players' | 'coaches' | 'clubs' | 'umpires' | 'brands' | 'questions'

// Labels are catalog keys (segments.<id>), translated where the chip renders.
const SEGMENTS: Array<{ id: Exclude<CommunityTab, 'questions'>; path: string }> = [
  { id: 'all', path: '/community' },
  { id: 'players', path: '/community/players' },
  { id: 'coaches', path: '/community/coaches' },
  { id: 'clubs', path: '/community/clubs' },
  { id: 'brands', path: '/community/brands' },
  { id: 'umpires', path: '/community/umpires' },
]

export function CommunitySegments({ activeTab }: { activeTab: CommunityTab }) {
  const t = useCommunityT()
  const navigate = useNavigate()
  const location = useLocation()
  // The typed search rides along: each chip is a route, but not a new search.
  const query = searchQueryOf(location.search)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
  }, [activeTab])

  return (
    <div className="relative">
    <div
      role="tablist"
      aria-label={t('segments.label')}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:px-0"
    >
      <div className="flex items-center gap-2">
        {SEGMENTS.map((s) => {
          const active = s.id === activeTab
          return (
            <button
              key={s.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => navigate(pathWithSearch(s.path, query))}
              className={`relative flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${
                chipTone(active)
              }`}
            >
              {t(`segments.${s.id}`)}
            </button>
          )
        })}
      </div>
    </div>
      {/* The row scrolls sideways: a fade on the right edge says so (Figma Community P1). */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-4 top-0 h-full w-8 bg-gradient-to-r from-white/0 to-white md:hidden" />
    </div>
  )
}
