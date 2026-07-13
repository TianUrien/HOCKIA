import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components'
import type { ScopedMatch } from '@/hooks/useScopedMatches'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Available now — fit your team" (club Pulse, Home V2 Phase 2): the top
 * in-scope candidates as a horizontal rail. The % is verdict.strength — the
 * SAME number the community grid shows, shown only for in-scope candidates
 * (near-misses fill slots without a %; hard-fails were excluded upstream).
 * Collapses when the pool has no rankable candidates (§C).
 */
const MODULE_ID = 'available_now'
const POSITION = 3

export function AvailableNowRail({ matches, loading, voice = 'club' }: { matches: ScopedMatch[]; loading: boolean; voice?: 'club' | 'coach' }) {
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
        title={voice === 'coach' ? 'Available now — fit your search' : 'Available now — fit your team'}
        chip={{ label: 'Open', tone: 'new' }}
        action={
          <button
            type="button"
            onClick={() => {
              trackModuleClick(MODULE_ID, POSITION)
              navigate('/community/players')
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
            <p className="truncate text-xs capitalize text-gray-500">
              {m.position ? m.position.replace(/_/g, ' ') : m.role}
            </p>
            {m.inScope ? (
              <p className="mt-1 text-sm font-black text-hockia-primary">{m.pct}% match</p>
            ) : (
              // Near-miss filler (longshot tier): labeled with Community's
              // display vocabulary so a %-less card reads as intended, not as
              // a missing number (QA: "2 fit" + 3 cards looked inconsistent).
              <p className="mt-1 text-xs font-semibold text-gray-400">Possible</p>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
