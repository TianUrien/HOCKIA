import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, Info, Plus, Star } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { ScoutPlayerRow } from './ScoutPlayerRow'
import { RankedForSheet } from './RankedForSheet'
import { useCountries, EU_COUNTRY_CODES } from '@/hooks/useCountries'
import { opportunityGenderToTarget, useRecruitingViewKind } from '@/hooks/useRecruitingContext'
import { useFindPlayers, useOwnLeague, useRoleShortlist, useScoutingContext, useShortlistWrites } from '@/hooks/useScouting'
import {
  applyFindFilters,
  contextFitTarget,
  contextPillLabel,
  evidenceLine,
  rowFullMatches,
  FIND_FILTERS,
  playerContexts,
  rankScoutRows,
  type ContextLike,
  type FindFilter,
  type ScoutRow,
} from '@/lib/findPlayers'
import { cn } from '@/lib/utils'

/**
 * Find players — club v2 (Figma 04 Club D1.9 332:318; DEV NOTE 332:738).
 * Scouting for one role, ranked for the active recruiting context (the pill
 * switches it): fit first, then evidence — full matches, highlights, career
 * — then recent activity. One tap shortlists to the active role's list;
 * applicants to that role show "Applied" and open Applicant review. Pool is
 * 18+ only (server). Clubs and recruiting coaches; phone only.
 */
export default function FindPlayersScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  // Only PLAYER roles rank players here (round 6): a coach-role context
  // stays stored for the Coaches tab.
  useRecruitingViewKind('player')
  const scouting = useScoutingContext()
  const { ctx, roleTitle, openRoles, viewer } = scouting
  const isClub = viewer?.role === 'club'
  const roleId = ctx?.type === 'opportunity' ? ctx.opportunity_id : null
  const { countries } = useCountries()
  const euIds = useMemo(() => new Set(countries.filter((c) => EU_COUNTRY_CODES.has(c.code)).map((c) => c.id)), [countries])
  // Open to play is on by default (Figma D1.9); switch it off to see every adult player.
  const [filters, setFilters] = useState<Set<FindFilter>>(() => new Set<FindFilter>(['open']))
  const [sheet, setSheet] = useState(false)
  const target = contextFitTarget(ctx)
  const ownLeague = useOwnLeague(target)
  const data = useFindPlayers(ctx, roleId)
  const writes = useShortlistWrites(roleTitle)
  const shortlist = useRoleShortlist(ctx, roleId, roleTitle)

  // Deep links: ?role=<id> (Role posted → "Find players for this role") makes
  // that role the active context; ?context=none (first run) clears it.
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current) return
    const want = params.get('role')
    const none = params.get('context') === 'none'
    if (!want && !none) { handled.current = true; return }
    if (none) {
      handled.current = true
      if (ctx) void scouting.clearActive()
      setParams({}, { replace: true })
      return
    }
    const r = openRoles.find((x) => x.id === want)
    if (!r) return // roles still loading
    handled.current = true
    if (ctx?.opportunity_id !== r.id) {
      void scouting.activateForOpportunity({ opportunityId: r.id, target: opportunityGenderToTarget(r.gender), region: null, label: r.title })
    }
    setParams({}, { replace: true })
  }, [params, openRoles, ctx, scouting, setParams])

  // A club whose own league has no level: say so, rank by evidence (DEV NOTE 332:745).
  const levelUnknown = !!target && !!ownLeague && ownLeague.band === null
  const rows = useMemo(() => {
    const adults = data.rows.filter((r) => r.age === null || r.age >= 18)
    return rankScoutRows(applyFindFilters(adults, filters, euIds), { byFit: !!target && !levelUnknown })
  }, [data.rows, filters, euIds, target, levelUnknown])

  const contexts = useMemo(() => playerContexts(scouting.contexts, new Set(openRoles.map((r) => r.id)), ctx?.id ?? null), [scouting.contexts, openRoles, ctx])
  const chips = FIND_FILTERS.filter((f) => f.id !== 'not_applied' || !!roleId)
  const toggle = (id: FindFilter) => setFilters((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const pick = (c: ContextLike | null) => {
    setSheet(false)
    if (c) void scouting.activate(c.id)
    else void scouting.clearActive()
  }
  const openProfile = (r: ScoutRow) => navigate(`/players/id/${r.id}`, { state: { from: location.pathname } })
  const openApplied = (r: ScoutRow) => {
    if (isClub && roleId && r.applicationId) navigate(`/dashboard/opportunities/${roleId}/applicants/${r.applicationId}`, { state: { from: location.pathname } })
    else openProfile(r)
  }
  const count = shortlist.rows.length

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="find-players-screen">
      <DetailNavBar
        parent="Opportunities"
        fallbackPath="/opportunities"
        trailing={(
          <button type="button" onClick={() => navigate('/dashboard/shortlist', { state: { from: location.pathname, parent: 'Find players' } })} className="flex h-11 items-center gap-1.5 px-2 text-body text-hockia-primary" data-testid="find-players-shortlist-link">
            <Star className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            <span>Shortlist{shortlist.loading ? '' : ` · ${count}`}</span>
          </button>
        )}
      />
      <div className="px-5 pb-3 pt-0.5">
        <h1 className="text-[30px] font-bold leading-9 tracking-[-0.36px] text-ink-1">Find players</h1>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[14px] text-ink-2">Ranked for</span>
          <button type="button" onClick={() => setSheet(true)} className="flex max-w-[240px] items-center gap-1 rounded-full bg-hockia-soft py-1 pl-2.5 pr-2 text-[14px] font-semibold text-hockia-primary" data-testid="ranked-for-pill">
            <span className="truncate">{contextPillLabel(ctx)}</span>
            <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filters">
        {chips.map((c) => {
          const on = filters.has(c.id)
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => toggle(c.id)} className={cn('shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold', on ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1')}>
              {c.label}
            </button>
          )
        })}
      </div>

      {(levelUnknown || !ctx) && (
        <div className="px-5 pt-3">
          <div className="flex items-start gap-2.5 rounded-card bg-surface-grouped p-3.5" data-testid="find-players-notice">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
            <p className="text-secondary leading-[18px] text-ink-2">
              {levelUnknown
                ? `${ownLeague?.name} has no level on Hockia yet, so fit can’t compare levels. Players are ranked by full matches, highlights and career.`
                : 'No role picked. Players are ranked by full matches, highlights and career. Pick a role to see fit.'}
            </p>
          </div>
        </div>
      )}

      {data.error && <p className="px-5 py-3 text-row text-ink-2">{data.error}</p>}
      {data.loading && <p className="px-5 py-4 text-row text-ink-3" aria-live="polite">Finding players…</p>}
      {!data.loading && !data.error && rows.length === 0 && (
        <p className="px-5 py-4 text-row text-ink-3">{filters.size ? 'No players match these filters.' : 'No players to show yet.'}</p>
      )}

      <div className="pt-1.5">
        {rows.map((r, i) => {
          const ev = evidenceLine({ fullMatches: rowFullMatches(r), highlights: r.highlights, career: r.career_entry_count ?? 0, lastActiveAt: r.last_active_at })
          const saved = writes.inList(r.id)
          const trailing = r.applicationId
            ? <button type="button" onClick={() => openApplied(r)} className="rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2">Applied</button>
            : saved
              ? (
                <button type="button" onClick={() => void writes.remove(r.id)} aria-label={`Remove ${r.full_name ?? 'player'} from the shortlist`} aria-pressed="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary">
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.4} />
                </button>
              )
              : (
                <button type="button" onClick={() => void writes.add(r.id)} aria-label={`Shortlist ${r.full_name ?? 'player'}`} aria-pressed="false" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-grouped text-ink-1">
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </button>
              )
          return (
            <div key={r.id}>
              <ScoutPlayerRow row={r} countries={countries} meta={ev} trailing={trailing} onOpen={() => openProfile(r)} testId="find-player-row" />
              {i < rows.length - 1 && <div className="ml-[84px] h-[0.5px] bg-line" />}
            </div>
          )
        })}
      </div>

      <RankedForSheet open={sheet} contexts={contexts} activeId={ctx?.id ?? null} roles={scouting.roles} onPick={pick} onClose={() => setSheet(false)} />
    </div>
  )
}
