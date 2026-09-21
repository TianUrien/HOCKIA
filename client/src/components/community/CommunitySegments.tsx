import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

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

const SEGMENTS: Array<{ id: Exclude<CommunityTab, 'questions'>; label: string; path: string }> = [
  { id: 'all', label: 'All', path: '/community' },
  { id: 'players', label: 'Players', path: '/community/players' },
  { id: 'coaches', label: 'Coaches', path: '/community/coaches' },
  { id: 'clubs', label: 'Clubs', path: '/community/clubs' },
  { id: 'brands', label: 'Brands', path: '/community/brands' },
  { id: 'umpires', label: 'Umpires', path: '/community/umpires' },
]

export function CommunitySegments({ activeTab }: { activeTab: CommunityTab }) {
  const navigate = useNavigate()
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
  }, [activeTab])

  return (
    <div
      role="tablist"
      aria-label="Member type"
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
              onClick={() => navigate(s.path)}
              className={`flex h-[34px] shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold transition-colors ${
                active ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1 active:bg-gray-200'
              }`}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
