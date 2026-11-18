import { BottomSheet } from '@/components/ui/BottomSheet'
import { Chip } from '@/components/ui/Chip'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import type { PlayingCategory } from '@/lib/hockeyCategories'
import { CountryFilterField } from './CountryFilterField'
import { useCommunityT } from '@/i18n/ns/community'
import { useEnumsT } from '@/i18n/ns/enums'
import { formatNumber } from '@/i18n/format'
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

// Labels are catalog keys, translated where each chip renders (enums.position.<value>).
const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
const ROLES: Exclude<RoleFilter, 'all'>[] = ['player', 'coach', 'club', 'brand', 'umpire']
// "Open to" — each chip reads its own profile column (founder 2026-09-20):
// Play → open_to_play, Coach → open_to_coach, Recruiting →
// coach_recruits_for_team / clubs with ≥1 open opportunity (toggle as the
// fallback — ruling 2026-09-21), Opportunities →
// open_to_opportunities. The same columns Settings › Availability writes.
const OPEN_TO: Exclude<AvailabilityFilter, 'all'>[] = ['play', 'coach', 'recruiting', 'opportunities']

// Phone sheet (Figma New Hockia 2 · Community P13 24:835): Availability ·
// Position · Team · EU passport. Role lives in the chips above the grid.
const AVAILABILITY: { value: 'play' | 'coach' | 'recruiting'; roles: RoleFilter[] }[] = [
  { value: 'play', roles: ['all', 'player'] },
  { value: 'coach', roles: ['all', 'coach'] },
  { value: 'recruiting', roles: ['all', 'club', 'coach'] },
]
const TEAMS: PlayingCategory[] = ['adult_women', 'adult_men', 'girls', 'boys', 'mixed']

/** Overline group label (Hockia 2/Overline). */
function GroupLabel({ children }: { children: string }) {
  return <h3 className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-3">{children}</h3>
}

/**
 * Community filters (Figma 116:631): Position, Role (incl. Brands and
 * Umpires), Open to (Play · Coach · Recruiting · Opportunities), and the EU
 * passport toggle as a first-class row. Geography is back (founder
 * 2026-11-09): "Based in" (where members live; a club's or brand's own
 * country) and "Nationality" (passport, either one), kept apart because a
 * New Zealander can live in England. No appointments, no level, no match
 * scores. Live count on the button. Every option is the shared Chip
 * (selected = soft purple).
 */
export function CommunityFiltersDrawer({ state, resultCount, euCount = null, onSelectRole }: CommunityFiltersDrawerProps) {
  const t = useCommunityT()
  const tEnums = useEnumsT()
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
  // Clubs and brands have a country, not a passport.
  const showNationality = filters.role !== 'club' && filters.role !== 'brand'
  const basedInCaption = filters.role === 'club' || filters.role === 'brand'
    ? t('filters.basedInCaptionOrg')
    : filters.role === 'all'
      ? t('filters.basedInCaptionAll')
      : t('filters.basedInCaptionPerson')
  const countryFields = (
    <>
      <CountryFilterField
        label={t('filters.basedIn')}
        caption={basedInCaption}
        value={filters.locationCountryIds}
        onChange={(ids) => updateFilter('locationCountryIds', ids)}
        testId="community-filter-based-in"
      />
      {showNationality && (
        <CountryFilterField
          label={t('filters.nationality')}
          caption={t('filters.nationalityCaption')}
          value={filters.nationalityCountryIds}
          onChange={(ids) => updateFilter('nationalityCountryIds', ids)}
          withFlags
          testId="community-filter-nationality"
        />
      )}
    </>
  )
  // Brands / clubs tabs count brands / clubs, not members (QA copy nit).
  const noun = filters.role === 'brand' ? 'Brands' : filters.role === 'club' ? 'Clubs' : 'Members'
  const showLabel = count === null
    ? t(`filters.show${noun}`)
    : t(`filters.show${noun}Count`, { count, formatted: formatNumber(count) })

  if (isPhone) {
    return (
      <BottomSheet open={showFilters} onClose={close} ariaLabel={t('filters.title')}>
        <div className="flex flex-col gap-5 px-5 pb-2 pt-1" data-testid="community-filters-sheet">
          <div className="flex items-center justify-between">
            <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.006em] text-ink-1">{t('filters.title')}</h2>
            <button type="button" onClick={() => { clearFilters(); if (filters.role !== 'all') onSelectRole('all') }} className="-my-2 flex min-h-[44px] items-center text-[14px] font-semibold text-hockia-primary">
              {t('filters.reset')}
            </button>
          </div>

          {AVAILABILITY.some((a) => a.roles.includes(filters.role)) && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>{t('filters.availability')}</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY.filter((a) => a.roles.includes(filters.role)).map((a) => (
                  <Chip key={a.value} label={t(`filters.availabilityOption.${a.value}`)} selected={filters.availability === a.value} onClick={() => setOpenTo(a.value)} />
                ))}
              </div>
            </section>
          )}

          {showPositions && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>{t('filters.position')}</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((p) => (
                  <Chip key={p} label={tEnums(`position.${p}`)} selected={filters.position.includes(p)} onClick={() => togglePosition(p)} />
                ))}
              </div>
            </section>
          )}

          {showTeams && (
            <section className="flex flex-col gap-2.5">
              <GroupLabel>{t('filters.team')}</GroupLabel>
              <div className="flex flex-wrap gap-2">
                {TEAMS.map((team) => (
                  <Chip key={team} label={t(`filters.teamOption.${team}`)} selected={filters.categories.includes(team)} onClick={() => toggleTeam(team)} />
                ))}
              </div>
            </section>
          )}

          {countryFields}

          {filters.role === 'brand' && (
            <SwitchCardRow
              title={t('filters.partnersTitle')}
              description={t('filters.partnersDescription')}
              checked={filters.brandOpenToPartners}
              onChange={() => updateFilter('brandOpenToPartners', !filters.brandOpenToPartners)}
              testId="community-filter-partners"
            />
          )}

          {showEu && (
            <SwitchCardRow
              title={t('filters.euTitle')}
              description={euCount === null ? t('filters.euDescription') : t('filters.euCount', { count: euCount, formatted: formatNumber(euCount) })}
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
    <BottomSheet open={showFilters} onClose={close} ariaLabel={t('filters.title')}>
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-title text-ink-1">{t('filters.title')}</h2>
          <button type="button" onClick={() => { clearFilters(); if (filters.role !== 'all') onSelectRole('all') }} className="-my-2 flex min-h-[44px] items-center text-row font-semibold text-hockia-primary">
            {t('filters.reset')}
          </button>
        </div>

        {showPositions && (
          <section className="flex flex-col gap-2.5">
            <h3 className="text-row font-semibold text-ink-1">{t('filters.position')}</h3>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((p) => (
                <Chip key={p} label={tEnums(`position.${p}`)} selected={filters.position.includes(p)} onClick={() => togglePosition(p)} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">{t('filters.role')}</h3>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <Chip key={r} label={t(`filters.roleOption.${r}`)} selected={filters.role === r} onClick={() => onSelectRole(filters.role === r ? 'all' : r)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-row font-semibold text-ink-1">{t('filters.openTo')}</h3>
          <div className="flex flex-wrap gap-2">
            {OPEN_TO.map((o) => (
              <Chip key={o} label={t(`filters.openToOption.${o}`)} selected={filters.availability === o} onClick={() => setOpenTo(o)} />
            ))}
          </div>
        </section>

        {countryFields}

        {filters.role !== 'club' && filters.role !== 'brand' && (
          <button
            type="button"
            role="switch"
            aria-checked={filters.euOnly}
            onClick={() => updateFilter('euOnly', !filters.euOnly)}
            className="flex items-center gap-3 rounded-card bg-surface-grouped px-3.5 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-row font-semibold text-ink-1">{t('filters.euDesktopTitle')}</span>
              <span className="block truncate text-secondary text-ink-2">{t('filters.euDesktopDescription')}</span>
            </span>
            <span className={cn('flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold', filters.euOnly ? 'bg-positive-soft text-positive' : 'bg-white text-ink-2')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', filters.euOnly ? 'bg-positive' : 'bg-ink-4')} />
              {filters.euOnly ? t('filters.on') : t('filters.off')}
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
