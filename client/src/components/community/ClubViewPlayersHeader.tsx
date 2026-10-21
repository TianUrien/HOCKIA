import { ChevronDown } from 'lucide-react'
import { RankedForControl } from '@/components/recruiting/RankedForControl'
import { useScoutingContext } from '@/hooks/useScouting'
import { contextFitTarget } from '@/lib/findPlayers'
import { clubViewSortOptions } from '@/lib/communityClubView'
import type { SortOption } from './communityFilters'

/**
 * Community · club view header (Figma D1.17 352:995): "Players" with the sort
 * ("Best fit" while a player context ranks the grid) and the "Ranked for"
 * pill (the shared RankedForControl, Figma U1), the one context control.
 * Phone only; clubs and coaches who recruit (the page gates it). Replaces
 * the "Match for" context chip on this screen — same context, v2 styling.
 */
export function ClubViewPlayersHeader({ sort, onSort }: { sort: SortOption; onSort: (s: SortOption) => void }) {
  const scouting = useScoutingContext()
  const fitActive = !!contextFitTarget(scouting.ctx)
  const options = clubViewSortOptions(fitActive)

  return (
    <div className="mb-3 lg:hidden" data-testid="club-view-players-header">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold leading-7 text-ink-1">Players</h2>
        <label className="relative flex shrink-0 items-center text-[15px] font-semibold text-hockia-primary">
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOption)}
            className="min-h-[36px] cursor-pointer appearance-none border-0 bg-transparent py-0 pl-1 pr-6 text-right [text-align-last:right] text-[15px] font-semibold text-hockia-primary focus:outline-none focus-visible:ring-0"
            data-testid="club-view-sort"
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        </label>
      </div>
      <div className="pt-1.5">
        <RankedForControl kind="player" />
      </div>
    </div>
  )
}
