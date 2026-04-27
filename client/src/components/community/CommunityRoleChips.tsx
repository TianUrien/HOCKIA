import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CommunityTab } from './CommunityTabSwitcher'

interface RoleChip {
  id: Extract<CommunityTab, 'all' | 'players' | 'coaches' | 'clubs' | 'umpires'>
  label: string
  path: string
}

const CHIPS: RoleChip[] = [
  { id: 'all', label: 'All', path: '/community' },
  { id: 'players', label: 'Players', path: '/community/players' },
  { id: 'coaches', label: 'Coaches', path: '/community/coaches' },
  { id: 'clubs', label: 'Clubs', path: '/community/clubs' },
  { id: 'umpires', label: 'Umpires', path: '/community/umpires' },
]

interface CommunityRoleChipsProps {
  activeTab: CommunityTab
}

export function CommunityRoleChips({ activeTab }: CommunityRoleChipsProps) {
  const navigate = useNavigate()
  const activeChipRef = useRef<HTMLButtonElement>(null)

  // Keep the active chip visible — without this, hitting /community/umpires
  // directly leaves the Umpires chip scrolled off-screen on narrow viewports
  // and no chip appears active.
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeTab])

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
      {CHIPS.map(chip => {
        const isActive = chip.id === activeTab
        return (
          <button
            type="button"
            key={chip.id}
            ref={isActive ? activeChipRef : undefined}
            onClick={() => navigate(chip.path)}
            aria-pressed={isActive}
            className={`flex-shrink-0 inline-flex items-center px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              isActive
                ? 'bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white border-transparent shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
