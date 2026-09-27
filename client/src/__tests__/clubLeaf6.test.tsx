/**
 * Club v2 leaf 6 — Find players (Figma D1.9) + per-role Shortlist (D1.10) +
 * Recruiting for (D1.23). Pure helpers first, then the screens with their
 * data hooks mocked, then the phone/recruiter route gate.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyFindFilters,
  contextFitTarget,
  contextPillLabel,
  evidenceLine,
  holdsEuPassport,
  nationalityLine,
  playerContexts,
  rankScoutRows,
  rowFactsLine,
  shortlistForContext,
  shortlistHeaderLine,
  shortlistSourceLine,
  type ContextLike,
  type ScoutRow,
} from '@/lib/findPlayers'

const NOW = new Date('2026-09-27T12:00:00Z')

function row(p: Partial<ScoutRow> & { id: string }): ScoutRow {
  return {
    full_name: p.id, avatar_url: null, role: 'player', position: 'midfielder', secondary_position: null,
    nationality_country_id: null, nationality2_country_id: null, current_club: null, current_world_club_id: null,
    playing_category: 'adult_men', open_to_play: false, available_from: null, last_active_at: null,
    full_game_video_count: 0, career_entry_count: 0, fitState: null, fitScore: null, highlights: 0, age: 25,
    league: null, availabilityDuration: null, applicationId: null,
    ...p,
  }
}

const ctx = (p: Partial<ContextLike> & { id: string }): ContextLike => ({
  type: 'opportunity', label: null, target_category: 'Men', target_position: 'midfielder', target_role: 'player', opportunity_id: null, ...p,
})

describe('evidence line (DEV NOTE 332:742)', () => {
  it('shows only non-zero counts, in the Figma wording', () => {
    expect(evidenceLine({ fullMatches: 2, highlights: 0, career: 0, lastActiveAt: null }, NOW)?.text).toBe('2 full matches')
    expect(evidenceLine({ fullMatches: 0, highlights: 6, career: 7, lastActiveAt: null }, NOW)?.text).toBe('6 highlights · 7 career')
    expect(evidenceLine({ fullMatches: 1, highlights: 4, career: 0, lastActiveAt: null }, NOW)?.text).toBe('1 full match · 4 highlights')
    expect(evidenceLine({ fullMatches: 0, highlights: 0, career: 1, lastActiveAt: null }, NOW)).toEqual({ kind: 'career', text: '1 career entry' })
  })
  it('falls back to "Active N days ago" when there is no evidence', () => {
    expect(evidenceLine({ fullMatches: 0, highlights: 0, career: 0, lastActiveAt: '2026-09-26T10:00:00Z' }, NOW)).toEqual({ kind: 'active', text: 'Active yesterday' })
    expect(evidenceLine({ fullMatches: 0, highlights: 0, career: 0, lastActiveAt: '2026-09-15T12:00:00Z' }, NOW)?.text).toBe('Active 12 days ago')
    expect(evidenceLine({ fullMatches: 0, highlights: 0, career: 0, lastActiveAt: null }, NOW)).toBeNull()
  })
})

describe('ranking (DEV NOTE 332:741)', () => {
  const rows = [
    row({ id: 'a', fitScore: 0.6, full_game_video_count: 3 }),
    row({ id: 'b', fitScore: 0.8 }),
    row({ id: 'c', fitScore: 0.6, highlights: 5 }),
    row({ id: 'd', fitScore: null, full_game_video_count: 9 }),
    row({ id: 'e', fitScore: 0.6, career_entry_count: 2, last_active_at: '2026-09-01' }),
  ]
  it('fit first, then full matches, highlights, career, then activity', () => {
    expect(rankScoutRows(rows, { byFit: true }).map((r) => r.id)).toEqual(['b', 'a', 'c', 'e', 'd'])
  })
  it('ranks by evidence alone when there is no fit to rank by', () => {
    expect(rankScoutRows(rows, { byFit: false }).map((r) => r.id)).toEqual(['d', 'a', 'c', 'e', 'b'])
  })
})

describe('filters (DEV NOTE 332:743)', () => {
  const eu = new Set([10, 11])
  const rows = [
    row({ id: 'open', open_to_play: true, nationality_country_id: 1 }),
    row({ id: 'fm', full_game_video_count: 1, nationality2_country_id: 10 }),
    row({ id: 'applied', applicationId: 'app1', open_to_play: true }),
    row({ id: 'nonat' }),
  ]
  it('EU passport = either nationality in the EU list; unknown nationality does not pass', () => {
    expect(holdsEuPassport(1, 10, eu)).toBe(true)
    expect(holdsEuPassport(null, null, eu)).toBe(false)
    expect(applyFindFilters(rows, new Set(['eu']), eu).map((r) => r.id)).toEqual(['fm'])
  })
  it('combines filters', () => {
    expect(applyFindFilters(rows, new Set(['open']), eu).map((r) => r.id)).toEqual(['open', 'applied'])
    expect(applyFindFilters(rows, new Set(['open', 'not_applied']), eu).map((r) => r.id)).toEqual(['open'])
    expect(applyFindFilters(rows, new Set(['full_match']), eu).map((r) => r.id)).toEqual(['fm'])
  })
})

describe('row lines', () => {
  const countries = [
    { id: 1, name: 'Argentina', flag_emoji: '🇦🇷', code: 'AR' },
    { id: 2, name: 'Italy', flag_emoji: '🇮🇹', code: 'IT' },
  ]
  it('writes out one or two nationalities with flags', () => {
    expect(nationalityLine([1, 2], countries)).toBe('🇦🇷 🇮🇹 Argentina · Italy')
    expect(nationalityLine([1, 1], countries)).toBe('🇦🇷 Argentina')
    expect(nationalityLine([null, null], countries)).toBeNull()
  })
  it('key facts: plays at + league (self-reported labelled), age, EU passport, availability', () => {
    const line = rowFactsLine({
      currentClub: 'CA Tigre',
      league: { name: 'Serie A Elite', source: 'self_reported' },
      age: 24,
      passports: [{ name: 'Italy', isEu: true }],
      openToPlay: true,
      availableFrom: '2026-01-01',
      availabilityDuration: null,
    }, NOW)
    expect(line).toBe('CA Tigre · Serie A Elite · self-reported · Age 24 · EU passport · Available now')
  })
  it('leaves missing facts out of the compact row', () => {
    expect(rowFactsLine({ currentClub: null, league: null, age: null, passports: [], openToPlay: false, availableFrom: null, availabilityDuration: null }, NOW)).toBeNull()
  })
})

describe('recruiting context + per-role shortlist', () => {
  it('pill reads position · team, else the saved label', () => {
    expect(contextPillLabel(ctx({ id: 'c1' }))).toBe('Midfielder · Men\'s')
    expect(contextPillLabel(ctx({ id: 'c2', target_position: null, target_category: null, label: 'Summer scouting' }))).toBe('Summer scouting')
    expect(contextPillLabel(null)).toBe('No context')
  })
  it('fit target must be exactly Men / Women / Mixed, and only for player contexts', () => {
    expect(contextFitTarget(ctx({ id: 'c', target_category: 'Women' }))).toBe('Women')
    expect(contextFitTarget(ctx({ id: 'c', target_role: 'coach' }))).toBeNull()
    expect(contextFitTarget(ctx({ id: 'c', target_category: null }))).toBeNull()
  })
  it('lists open player roles and saved contexts, plus the active one', () => {
    const rows = [
      ctx({ id: 'open', opportunity_id: 'r1' }),
      ctx({ id: 'closed', opportunity_id: 'r2' }),
      ctx({ id: 'coach', opportunity_id: 'r3', target_role: 'coach' }),
      ctx({ id: 'custom', type: 'custom', opportunity_id: null }),
      ctx({ id: 'activeClosed', opportunity_id: 'r4' }),
    ]
    expect(playerContexts(rows, new Set(['r1', 'r3']), 'activeClosed').map((r) => r.id)).toEqual(['open', 'custom', 'activeClosed'])
  })
  it('each role has its own list (named after the role); no role → default list', () => {
    const lists = [
      { id: 'd', name: 'Saved players', is_default: true },
      { id: 'm', name: 'Men’s 1st player', is_default: false },
    ]
    expect(shortlistForContext(lists, ' men’s 1st PLAYER ')?.id).toBe('m')
    expect(shortlistForContext(lists, 'Goalkeeper')).toBeNull()
    expect(shortlistForContext(lists, null)?.id).toBe('d')
  })
  it('source line: applicants win; scouted shows the save date', () => {
    expect(shortlistSourceLine({ applied: true, position: 'midfielder', shortlistedAt: '2026-09-23T10:00:00', savedAt: '2026-09-01T10:00:00' })).toBe('Applied to Midfielder · shortlisted Sep 23')
    expect(shortlistSourceLine({ applied: false, position: null, shortlistedAt: null, savedAt: '2026-09-20T10:00:00' })).toBe('Scouted · saved Sep 20')
    expect(shortlistHeaderLine(4)).toBe('4 players · only your club sees this')
    expect(shortlistHeaderLine(1)).toBe('1 player · only your club sees this')
  })
})

// ── Screens ──────────────────────────────────────────────────────────

const scoutingState = vi.hoisted(() => ({
  ctx: null as unknown,
  findRows: [] as unknown[],
  shortRows: [] as unknown[],
  inList: new Set<string>(),
  add: vi.fn(),
  remove: vi.fn(),
  entryRemove: vi.fn(),
  setNote: vi.fn(),
  activate: vi.fn(),
  clearActive: vi.fn(),
  viewerRole: 'club' as string,
  isPhone: true,
}))

vi.mock('@/hooks/useScouting', () => ({
  useScoutingContext: () => ({
    recruits: true,
    viewer: { id: 'club1', role: scoutingState.viewerRole },
    ctx: scoutingState.ctx,
    contexts: scoutingState.ctx ? [scoutingState.ctx] : [],
    loading: false,
    openRoles: [{ id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', opportunity_type: 'player' }],
    roles: new Map([['r1', { title: 'Men’s 1st player', toReview: 3 }]]),
    role: null,
    roleTitle: 'Men’s 1st player',
    activate: scoutingState.activate,
    clearActive: scoutingState.clearActive,
    activateForOpportunity: vi.fn(),
  }),
  useOwnLeague: () => ({ name: 'Irish Hockey League', band: 7 }),
  useFindPlayers: () => ({ rows: scoutingState.findRows, loading: false, error: null, refetch: vi.fn() }),
  useShortlistWrites: () => ({ list: null, inList: (id: string) => scoutingState.inList.has(id), add: scoutingState.add, remove: scoutingState.remove }),
  useRoleShortlist: () => ({ list: null, rows: scoutingState.shortRows, loading: false, error: null, queryKey: ['k'] }),
  useShortlistEntryActions: () => ({ remove: scoutingState.entryRemove, setNote: scoutingState.setNote }),
}))
vi.mock('@/hooks/useCountries', () => ({
  EU_COUNTRY_CODES: new Set(['IT']),
  isEuCountryCode: (c: string | null | undefined) => c === 'IT',
  useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }, { id: 2, name: 'Italy', code: 'IT', flag_emoji: '🇮🇹' }] }),
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'club1' }, profile: { id: 'club1', role: scoutingState.viewerRole } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => scoutingState.isPhone }))

import FindPlayersScreen from '@/components/club/FindPlayersScreen'
import { FindPlayersEntry, ShortlistEntry } from '@/pages/ClubRecruitingRoutes'
import ShortlistScreen from '@/components/club/ShortlistScreen'

const renderAt = (el: React.ReactNode, path = '/dashboard/find-players') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={el} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  scoutingState.ctx = ctx({ id: 'c1', opportunity_id: 'r1', label: 'Men’s 1st player' })
  scoutingState.viewerRole = 'club'
  scoutingState.isPhone = true
  scoutingState.inList = new Set(['p1'])
  scoutingState.findRows = [
    row({ id: 'p2', full_name: 'Leandro Bica', fitScore: 0.6, fitState: 'yellow', applicationId: 'app9', nationality_country_id: 1, full_game_video_count: 1, highlights: 4 }),
    row({ id: 'p1', full_name: 'Facundo Diaz', fitScore: 0.8, fitState: 'green', nationality_country_id: 1, full_game_video_count: 2, open_to_play: true }),
    row({ id: 'p3', full_name: 'Mitchell Eager', fitScore: 0.7, fitState: 'green', last_active_at: new Date(Date.now() - 86_400_000).toISOString() }),
    row({ id: 'minor', full_name: 'Too Young', fitScore: 0.9, fitState: 'green', age: 16 }),
    row({ id: 'grey', full_name: 'Grey Fit', fitScore: 0.2, fitState: 'grey' }),
  ]
  scoutingState.shortRows = [
    { ...row({ id: 'p1', full_name: 'Facundo Diaz', fitScore: 0.8, fitState: 'green' }), savedId: 's1', savedAt: '2026-09-23T10:00:00', note: 'Ask when the season ends.', shortlistedApp: null },
    { ...row({ id: 'p2', full_name: 'Leandro Bica', fitScore: 0.6, fitState: 'yellow' }), savedId: null, savedAt: null, note: null, shortlistedApp: { id: 'app9', position: 'midfielder', at: '2026-09-23T10:00:00', metadata: {} } },
  ]
  for (const f of [scoutingState.add, scoutingState.remove, scoutingState.entryRemove, scoutingState.setNote, scoutingState.activate, scoutingState.clearActive]) f.mockReset()
})

describe('Find players screen (D1.9)', () => {
  it('ranks by fit, never lists under-18s, and shows fit chips (grey = none)', () => {
    renderAt(<FindPlayersScreen />)
    const names = screen.getAllByTestId('find-player-row').map((r) => r.querySelector('span span')?.textContent)
    expect(names).toEqual(['Facundo Diaz', 'Mitchell Eager', 'Leandro Bica', 'Grey Fit'])
    expect(screen.queryByText('Too Young')).toBeNull()
    expect(screen.getAllByText('Strong fit')).toHaveLength(2)
    expect(screen.getAllByText('Possible fit')).toHaveLength(1)
    expect(screen.getByText('Midfielder · Men\'s')).toBeTruthy()
    expect(screen.getByText('2 full matches')).toBeTruthy()
    expect(screen.getByText('Active yesterday')).toBeTruthy()
  })

  it('applicants show Applied instead of +; ✓ removes; + shortlists to the role list', () => {
    renderAt(<FindPlayersScreen />)
    expect(screen.getByRole('button', { name: 'Applied' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Facundo Diaz from the shortlist' }))
    expect(scoutingState.remove).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Shortlist Mitchell Eager' }))
    expect(scoutingState.add).toHaveBeenCalledWith('p3', 'Mitchell')
  })

  it('filters narrow the list', () => {
    renderAt(<FindPlayersScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Open to play' }))
    expect(screen.getAllByTestId('find-player-row')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open to play' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not applied' }))
    expect(screen.queryByText('Leandro Bica')).toBeNull()
  })

  it('the pill opens Recruiting for; picking No context clears the active context', () => {
    renderAt(<FindPlayersScreen />)
    fireEvent.click(screen.getByTestId('ranked-for-pill'))
    expect(screen.getByText('Recruiting for')).toBeTruthy()
    expect(screen.getByText('From your open role · 3 to review')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /No context/ }))
    expect(scoutingState.clearActive).toHaveBeenCalled()
  })

  it('without a context: no Not applied chip, and the notice explains the evidence ranking', () => {
    scoutingState.ctx = null
    renderAt(<FindPlayersScreen />)
    expect(screen.queryByRole('button', { name: 'Not applied' })).toBeNull()
    expect(screen.getByTestId('find-players-notice').textContent).toMatch(/ranked by full matches/)
  })
})

describe('Shortlist screen (D1.10)', () => {
  it('lists scouted and applicants with source lines, private note and privacy footer', () => {
    renderAt(<ShortlistScreen />, '/dashboard/shortlist')
    expect(screen.getByText('2 players · only your club sees this')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All · 2' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Applied · 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Scouted · 1' })).toBeTruthy()
    expect(screen.getByText('Scouted · saved Sep 23')).toBeTruthy()
    expect(screen.getByText('Applied to Midfielder · shortlisted Sep 23')).toBeTruthy()
    expect(screen.getByTestId('shortlist-note').textContent).toBe('Ask when the season ends.')
    expect(screen.getByText('Players are never told they’re on your shortlist. Notes are private to your club.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Applied · 1' }))
    expect(screen.getAllByTestId('shortlist-row')).toHaveLength(1)
  })

  it('long-press menu: Edit note for scouted rows, Remove moves an applicant to Maybe', () => {
    renderAt(<ShortlistScreen />, '/dashboard/shortlist')
    const [first, second] = screen.getAllByTestId('shortlist-row')
    fireEvent.contextMenu(first.querySelector('button') as HTMLElement)
    expect(screen.getByRole('menuitem', { name: 'Edit note' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit note' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '  Call on Monday ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(scoutingState.setNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'Call on Monday')
    fireEvent.contextMenu(second.querySelector('button') as HTMLElement)
    expect(screen.queryByRole('menuitem', { name: /note/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    expect(scoutingState.entryRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }))
  })
})

describe('routes: phone + recruiters only', () => {
  const at = (el: React.ReactNode, path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/find-players" element={el} />
        <Route path="/dashboard/shortlist" element={el} />
        <Route path="/community/players" element={<p>community</p>} />
        <Route path="/dashboard/shortlists" element={<p>v1 shortlists</p>} />
        <Route path="/home" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  )
  it('a player never reaches Find players or the Shortlist', () => {
    scoutingState.viewerRole = 'player'
    at(<FindPlayersEntry />, '/dashboard/find-players')
    expect(screen.getByText('community')).toBeTruthy()
  })
  it('desktop keeps the v1 shortlists', () => {
    scoutingState.isPhone = false
    at(<ShortlistEntry />, '/dashboard/shortlist')
    expect(screen.getByText('v1 shortlists')).toBeTruthy()
  })
  it('a club on a phone gets the v2 screen', async () => {
    at(<FindPlayersEntry />, '/dashboard/find-players')
    expect(await screen.findByTestId('find-players-screen')).toBeTruthy()
  })
})
