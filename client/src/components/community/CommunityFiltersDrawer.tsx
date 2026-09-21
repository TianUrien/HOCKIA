import { BottomSheet } from '@/components/ui/BottomSheet'
import { cn } from '@/lib/utils'
import type { AvailabilityFilter, CommunityFiltersState, RoleFilter } from './communityFilters'

interface CommunityFiltersDrawerProps {
  state: CommunityFiltersState
  /** Live count of members matching the current filters — the footer button says "Show N members". */
  resultCount?: number | null
  /** Kept for callers; the Figma sheet carries no video toggle. */
  videoCount?: number | null
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-9 items-center rounded-full px-3.5 text-row font-semibold transition-colors',
        active ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Community filters (Figma 116:631): Position, Role (incl. Brands and
 * Umpires), Open to (Play · Coach · Recruiting · Opportunities), and the EU
 * passport toggle as a first-class row. No geography, no appointments, no
 * level, no match scores. Live count on the button.
 */
export function CommunityFiltersDrawer({ state, resultCount, onSelectRole }: CommunityFiltersDrawerProps) {
  const { filters, updateFilter, clearFilters, togglePosition, showFilters, setShowFilters } = state
  const close = () => setShowFilters(false)
  const showPositions = filters.role === 'all' || filters.role === 'player'
  const count = resultCount ?? null
  const setOpenTo = (value: AvailabilityFilter) => updateFilter('availability', filters.availability === value ? 'all' : value)

  return (
    <BottomSheet open={showFilters} onClose={close} ariaLabel="Filters">
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-title text-ink-1">Filters</h2>
          <button type="button" onClick={() => { clearFilters(); if (filters.role !== 'all') onSelectRole('all') }} className="text-row font-semibold text-hockia-primary">
            Reset
          </button>
        </div>

        {showPositions && (
          <section className="flex flex-col gap-2.5">
            <h3 className="text-row font-semibold text-ink-1">Position</h3>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((p) => (
                <Chip key={p.value} active={filters.position.includes(p.value)} onClick={() => togglePosition(p.value)}>{p.label}</Chip>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Role</h3>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <Chip key={r.role} active={filters.role === r.role} onClick={() => onSelectRole(filters.role === r.role ? 'all' : r.role)}>{r.label}</Chip>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">Open to</h3>
          <div className="flex flex-wrap gap-2">
            {OPEN_TO.map((o) => (
              <Chip key={o.value} active={filters.availability === o.value} onClick={() => setOpenTo(o.value)}>{o.label}</Chip>
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
          {count === null ? 'Show members' : count === 1 ? 'Show 1 member' : `Show ${count.toLocaleString()} members`}
        </button>
      </div>
    </BottomSheet>
  )
}
