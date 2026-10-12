import { BottomSheet } from '@/components/ui/BottomSheet'
import { Chip } from '@/components/ui/Chip'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import type { PlayingCategory } from '@/lib/hockeyCategories'
import type { AvailabilityFilter, CommunityFiltersState, RoleFilter } from './communityFilters'

interface CommunityFiltersDrawerProps {
  state: CommunityFiltersState
  /** Live count of members matching the current filters — the footer button says "Show N members". */
  resultCount?: number | null
  /** Kept for callers; the Figma sheet carries no video toggle. */
  videoCount?: number | null
  /** Members in the current pool who hold an EU passport — "69 members hold one" (P13). */
  euCount?: number | null
  /** Set the member type (role). Navigates the same /community/<role> URL the
   *  chips use, so both affordances write the one source of truth. */
  onSelectRole: (role: RoleFilter) => void
}

const POSITIONS = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
]
const ROLES: { role: RoleFilter; label: string }[] = [
  { role: 'player', label: 'Players' },
  { role: 'coach', label: 'Coaches' },
  { role: 'club', label: 'Clubs' },
  { role: 'brand', label: 'Brands' },
  { role: 'umpire', label: 'Umpires' },
]
// "Open to" — each chip reads its own profile column (founder 2026-09-20):
// Play → open_to_play, Coach → open_to_coach, Recruiting →
// coach_recruits_for_team / clubs with ≥1 open opportunity (toggle as the
// fallback — ruling 2026-09-21), Opportunities →
// open_to_opportunities. The same columns Settings › Availability writes.
const OPEN_TO: { value: Exclude<AvailabilityFilter, 'all'>; label: string }[] = [
  { value: 'play', label: 'Play' },
  { value: 'coach', label: 'Coach' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'opportunities', label: 'Opportunities' },
]

// Phone sheet (Figma New Hockia 2 · Community P13 24:835): Availability ·
// Position · Team · EU passport. Role lives in the chips above the grid.
const AVAILABILITY: { value: Exclude<AvailabilityFilter, 'all'>; label: string; roles: RoleFilter[] }[] = [
  { value: 'play', label: 'Open to play', roles: ['all', 'player'] },
  { value: 'coach', label: 'Open to coach', roles: ['all', 'coach'] },
  { value: 'recruiting', label: 'Recruiting', roles: ['all', 'club', 'coach'] },
]
const TEAMS: { value: PlayingCategory; label: string }[] = [
  { value: 'adult_women', label: 'Women’s' },
  { value: 'adult_men', label: 'Men’s' },
  { value: 'girls', label: 'Girls' },
  { value: 'boys', label: 'Boys' },
  { value: 'mixed', label: 'Mixed' },
]

/** Overline group label (Hockia 2/Overline). */
function GroupLabel({ children }: { children: string }) {
  return <h3 className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-3">{children}</h3>
}

/**
 * Community filters (Figma 116:631): Position, Role (incl. Brands and
 * Umpires), Open to (Play · Coach · Recruiting · Opportunities), and the EU
 * passport toggle as a first-class row. No geography, no appointments, no
 * level, no match scores. Live count on the button. Every option is the
 * shared Chip (selected = soft purple).
 */
export function CommunityFiltersDrawer({ state, resultCount, euCount = null, onSelectRole }: CommunityFiltersDrawerProps) {
  const { filters, updateFilter, clearFilters, togglePosition, showFilters, setShowFilters } = state
  const close = () => setShowFilters(false)
  // Phone = Figma New Hockia 2 P13 (below). Desktop keeps the earlier controls.
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const showPositions = filters.role === 'all' || filters.role === 'player'
  const count = resultCount ?? null
  const setOpenTo = (value: AvailabilityFilter) => updateFilter('availability', filters.availability === value ? 'all' : value)
  const toggleTeam = (value: PlayingCategory) =>
    updateFilter('categories', filters.categories.includes(value) ? filters.categories.filter((c) => c !== value) : [...filters.categories, value])
  const showTeams = filters.role !== 'club' && filters.role !== 'brand'
  const showEu = filters.role !== 'club' && filters.role !== 'brand'
  const showLabel = count === null ? 'Show members' : count === 1 ? 'Show 1 member' : `Show ${count.toLocaleString()} members`

  if (isPhone) {
    return (
      <BottomSheet open={showFilters} onClose={close} ariaLabel="Filters">
        <div className="flex flex-col gap-5 px-5 pb-2 pt-1" data-testid="community-filters-sheet">
          <div className="flex items-center justify-between">
            <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.006em] text-ink-1">Filters</h2>
            <button type="button" onClick={() => { clearFilters(); if (filters.role !== 'all') onSelectRole('all') }} className="-my-2 flex min-h-[44px] items-center text-[14px] font-semibold text-hockia-primary">
              Reset
            </button>
          </div>

          {AVAILABILITY.some((a) => a.roles.includes(filters.role)) && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>Availability</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY.filter((a) => a.roles.includes(filters.role)).map((a) => (
                  <Chip key={a.value} label={a.label} selected={filters.availability === a.value} onClick={() => setOpenTo(a.value)} />
                ))}
              </div>
            </section>
          )}

          {showPositions && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>Position</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <Chip key={p.value} label={p.label} selected={filters.position.includes(p.value)} onClick={() => togglePosition(p.value)} />
                ))}
              </div>
            </section>
          )}

          {showTeams && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>Team</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {TEAMS.map((t) => (
                  <Chip key={t.value} label={t.label} selected={filters.categories.includes(t.value)} onClick={() => toggleTeam(t.value)} />
                ))}
              </div>
            </section>
          )}

          {filters.role === 'brand' && (
            <SwitchCardRow
              title="Looking for ambassadors"
              description="Brands open to new partners"
              checked={filters.brandOpenToPartners}
              onChange={() => updateFilter('brandOpenToPartners', !filters.brandOpenToPartners)}
              testId="community-filter-partners"
            />
          )}

          {showEu && (
            <SwitchCardRow
              title="Only EU passport holders"
              description={euCount === null ? 'Either nationality counts' : euCount === 1 ? '1 member holds one' : `${euCount.toLocaleString()} members hold one`}
              checked={filters.euOnly}
              onChange={() => updateFilter('euOnly', !filters.euOnly)}
              testId="community-filter-eu"
            />
          )}

          <button type="button" onClick={close} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })} data-testid="community-filter-show">
            {showLabel}
          </button>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open={showFilters} onClose={close} ariaLabel="Filters">
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-title text-ink-1">Filters</h2>
          <button type="button" onClick={() => { clearFilters(); if (filters.role !== 'all') onSelectRole('all') }} className="-my-2 flex min-h-[44px] items-center text-row font-semibold text-hockia-primary">
            Reset
          </button>
        </div>

        {showPositions && (
          <section className="flex flex-col gap-2.5">
            <h3 className="text-row font-semibold text-ink-1">Position</h3>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((p) => (
                <Chip key={p.value} label={p.label} selected={filters.position.includes(p.value)} onClick={() => togglePosition(p.value)} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Role</h3>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <Chip key={r.role} label={r.label} selected={filters.role === r.role} onClick={() => onSelectRole(filters.role === r.role ? 'all' : r.role)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Open to</h3>
          <div className="flex flex-wrap gap-2">
            {OPEN_TO.map((o) => (
              <Chip key={o.value} label={o.label} selected={filters.availability === o.value} onClick={() => setOpenTo(o.value)} />
            ))}
          </div>
        </section>

        {filters.role !== 'club' && filters.role !== 'brand' && (
          <button
            type="button"
            role="switch"
            aria-checked={filters.euOnly}
            onClick={() => updateFilter('euOnly', !filters.euOnly)}
            className="flex items-center gap-3 rounded-card bg-surface-grouped px-3.5 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-row font-semibold text-ink-1">Only members with an EU passport</span>
              <span className="block truncate text-secondary text-ink-2">Either nationality counts — dual passports included</span>
            </span>
            <span className={cn('flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold', filters.euOnly ? 'bg-positive-soft text-positive' : 'bg-white text-ink-2')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', filters.euOnly ? 'bg-positive' : 'bg-ink-4')} />
              {filters.euOnly ? 'On' : 'Off'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={close}
          className="mt-1 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white"
        >
          {showLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
