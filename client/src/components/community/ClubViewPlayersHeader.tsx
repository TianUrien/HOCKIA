import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { RankedForSheet } from '@/components/club/RankedForSheet'
import { useScoutingContext } from '@/hooks/useScouting'
import { contextFitTarget, contextPillLabel, playerContexts, type ContextLike } from '@/lib/findPlayers'
import { clubViewSortOptions } from '@/lib/communityClubView'
import type { SortOption } from './communityFilters'

/**
 * Community · club view header (Figma D1.17 352:995): "Players" with the sort
 * ("Best fit" while a player context ranks the grid) and the "Ranked for"
 * pill, which opens the same Recruiting for sheet as Find players (D1.23).
 * Phone only; clubs and coaches who recruit (the page gates it). Replaces
 * the "Match for" context chip on this screen — same context, v2 styling.
 */
export function ClubViewPlayersHeader({ sort, onSort }: { sort: SortOption; onSort: (s: SortOption) => void }) {
  const scouting = useScoutingContext()
  const { ctx, openRoles } = scouting
  const [sheet, setSheet] = useState(false)
  const fitActive = !!contextFitTarget(ctx)
  const options = clubViewSortOptions(fitActive)
  const contexts = useMemo(() => playerContexts(scouting.contexts, new Set(openRoles.map((r) => r.id)), ctx?.id ?? null), [scouting.contexts, openRoles, ctx])
  const pick = (c: ContextLike | null) => {
    setSheet(false)
    if (c) void scouting.activate(c.id)
    else void scouting.clearActive()
  }

  return (
    <div className="mb-3 lg:hidden" data-testid="club-view-players-header">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold leading-7 text-ink-1">Players</h2>
        <label className="relative flex shrink-0 items-center text-[15px] font-semibold text-hockia-primary">
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOption)}
            className="min-h-[36px] cursor-pointer appearance-none border-0 bg-transparent py-0 pl-1 pr-6 text-right [text-align-last:right] text-[15px] font-semibold text-hockia-primary focus:outline-none focus:ring-0"
            data-testid="club-view-sort"
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1.5">
        <span className="text-[14px] text-ink-2">Ranked for</span>
        <button type="button" onClick={() => setSheet(true)} className="flex min-w-0 max-w-[240px] items-center gap-1 rounded-full bg-hockia-soft py-1 pl-2.5 pr-2 text-[14px] font-semibold text-hockia-primary" data-testid="ranked-for-pill">
          <span className="truncate">{contextPillLabel(ctx)}</span>
          <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      <RankedForSheet open={sheet} contexts={contexts} activeId={ctx?.id ?? null} roles={scouting.roles} onPick={pick} onClose={() => setSheet(false)} />
    </div>
  )
}
