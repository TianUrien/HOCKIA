import { useNavigate } from 'react-router-dom'
import { positionLabel, roleLabel } from '@/lib/identity'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components'
import type { ScopedMatch } from '@/hooks/useScopedMatches'
import { SectionHeader } from './SectionHeader'
import { FitBadge } from '@/components/ui/FitBadge'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Available now — fit your team" (club Pulse, Home V2 Phase 2): the top
 * in-scope candidates as a horizontal rail, each with the one Fit badge
 * (Strong / Possible, never a percentage; hard-fails were excluded upstream).
 * Collapses when the pool has no rankable candidates (§C).
 */
const MODULE_ID = 'available_now'
const POSITION = 3

export function AvailableNowRail({ matches, loading, voice = 'club', poolRole = 'player' }: { matches: ScopedMatch[]; loading: boolean; voice?: 'club' | 'coach'; poolRole?: string }) {
  const navigate = useNavigate()
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  // Render only when at least one REAL fit exists: an all-longshot rail under
  // a "fit your team" title would contradict the hero's no-match state
  // (audit M4). Near-misses may still fill slots BEHIND real fits.
  if (loading || matches.length === 0 || !matches.some((m) => m.inScope)) return null

  // Coaches and players both live under /players/id (house profile routing).
  const open = (m: ScopedMatch) => {
    trackModuleClick(MODULE_ID, POSITION)
    navigate(`/players/id/${m.id}`)
  }

  return (
    <section ref={ref} className="mb-6">
      <SectionHeader
        title={voice === 'coach' ? 'Available now: fit your search' : 'Available now: fit your team'}
        chip={{ label: 'Open', tone: 'new' }}
        action={
          <button
            type="button"
            onClick={() => {
              trackModuleClick(MODULE_ID, POSITION)
              navigate(poolRole === 'coach' ? '/community/coaches' : '/community/players')
            }}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-hockia-primary"
          >
            See all
            <ChevronRight className="h-4 w-4" />
          </button>
        }
      />
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {matches.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => open(m)}
            className="w-[150px] flex-shrink-0 snap-start rounded-2xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="relative mx-auto w-fit">
              <Avatar
                src={m.avatar_url}
                initials={m.full_name?.slice(0, 2) || '?'}
                size="lg"
                role={m.role}
              />
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" aria-label="Open to opportunities" />
            </div>
            <p className="mt-2 truncate text-sm font-semibold text-[#14141c]">{m.full_name}</p>
            <p className="truncate text-xs text-gray-500">
              {positionLabel(m.position) ?? roleLabel(m.role)}
            </p>
            {/* The one Fit badge (audit B3): Strong / Possible, never a %. */}
            {m.fit && <span className="mt-1.5 flex justify-center"><FitBadge state={m.fit} /></span>}
          </button>
        ))}
      </div>
    </section>
  )
}
