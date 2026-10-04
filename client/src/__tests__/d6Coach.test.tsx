/**
 * D6 · Coach v2 (Figma 105:2): a coach is a candidate (player rules) and,
 * when they recruit for their team, a recruiter with the Club v2 toolset.
 *
 *  - Opportunities · Roles lists coaching roles only for a candidate coach;
 *    players and recruiting coaches keep the whole list.
 *  - No coaching role open: the empty state, the alert switch, the "Be
 *    ready" rows while career / references are missing, and the last closed
 *    roles with the coach's own status in grey.
 *  - My roles only for a coach who recruits, with "Recruiting for <club>"
 *    and one Primary on the role card.
 *  - Your week: the club version for a recruiting coach, the player version
 *    otherwise.
 *  - Coach key facts mapping, gaps reading "Not given".
 *
 * No test here reads the clock: every date is passed in.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// ── mocks ───────────────────────────────────────────────────────────────────
const navigateSpy = vi.fn()
const toggleSpy = vi.fn()
let authState: { user: { id: string } | null; profile: Record<string, unknown> | null } = { user: null, profile: null }
let phone = true
let tables: Record<string, unknown[]> = {}
let pulseMode: 'find' | 'recruit' = 'recruit'
let myRoles: { loading: boolean; open: unknown[]; closed: unknown[]; expiryDays: number; refresh: () => void } = { loading: false, open: [], closed: [], expiryDays: 14, refresh: () => undefined }
let history: { postedThisYear: number | null; recentlyClosed: unknown[]; loading: boolean } = { postedThisYear: null, recentlyClosed: [], loading: false }

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? [], count: 0, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'gte', 'update']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  return { supabase: { from: (t: string) => builder(t), rpc: vi.fn(() => Promise.resolve({ data: [], error: null })) } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: unknown) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/monitor', () => ({ monitor: { measure: (_n: string, fn: () => unknown) => fn() } }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => phone }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false }), isEuCountryCode: () => false }))
vi.mock('@/hooks/useOpportunityNotifications', () => {
  // Stable identities: the page re-fetches whenever markSeen changes.
  const stable = { count: 0, markSeen: async () => undefined, refresh: async () => undefined }
  return { useOpportunityNotifications: () => stable }
})
vi.mock('@/hooks/useScrollRestore', () => ({ useScrollRestore: () => undefined }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => undefined }))
vi.mock('@/hooks/useClubRoles', () => ({ useClubRoles: () => myRoles }))
vi.mock('@/hooks/useCoachingRolesHistory', () => ({ useCoachingRolesHistory: () => history }))
vi.mock('@/hooks/useProfileWriter', () => ({
  useProfileWriter: () => ({
    read: (column: string, fallback: unknown) => (authState.profile?.[column] ?? fallback),
    write: vi.fn(),
    toggle: toggleSpy,
    busy: null,
  }),
}))
vi.mock('@/hooks/useCoachPulseMode', () => ({ useCoachPulseMode: () => [pulseMode, vi.fn()] }))
vi.mock('@/hooks/useScouting', () => ({
  useScoutingContext: () => ({ ctx: null, roleTitle: null }),
  useRoleShortlist: () => ({ loading: false, rows: [] }),
}))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingViewKind: () => undefined }))
vi.mock('@/components/club/RoleActions', () => ({ RoleActions: () => null }))
vi.mock('@/components/Header', () => ({ default: () => null }))
vi.mock('@/components/OpportunityCard', () => ({ default: () => null }))
vi.mock('@/components/OpportunityPreviewModal', () => ({ default: () => null }))
vi.mock('@/components/CreateOpportunityModal', () => ({ default: () => <div data-testid="create-role-modal" /> }))
vi.mock('@/components/OpportunityJsonLd', () => ({ OpportunitiesListJsonLd: () => null }))
vi.mock('@/components/opportunities/OpportunityFiltersSheet', () => ({ OpportunityFiltersSheet: () => null }))
vi.mock('@/components/ui/EntityAvatar', () => ({ EntityAvatar: () => <span data-testid="entity-avatar" /> }))
// Your week sources
vi.mock('@/hooks/useWeeklyVisibility', () => ({ useWeeklyVisibility: () => ({ loading: false, visibility: { views_7d: 0 } }) }))
vi.mock('@/hooks/useOpportunitiesForYou', () => ({ useOpportunitiesForYou: () => ({ loading: false, mode: 'matched', items: [{}, {}] }) }))
vi.mock('@/hooks/useMyApplications', () => ({ useMyApplications: () => ({ loading: false, applications: [] }) }))
vi.mock('@/hooks/useRolesHealth', () => ({ useRolesHealth: (enabled: boolean) => ({ loading: false, totals: enabled ? { pending: 3, openRoles: 1, newApplicants: 0 } : { pending: 0, openRoles: 0, newApplicants: 0 } }) }))
vi.mock('@/hooks/useScopedMatches', () => ({ useScopedMatches: () => ({ loading: false, fitCount: 0 }) }))

import OpportunitiesPage from '@/pages/OpportunitiesPage'
import CoachMyRoles from '@/components/opportunities/CoachMyRoles'
import { CoachRolesEmptyState } from '@/components/opportunities/CoachRolesEmptyState'
import { YourWeekCard } from '@/components/home/YourWeekCard'
import { queryClient } from '@/lib/queryClient'
import { buildCoachKeyFacts, NOT_GIVEN } from '@/lib/keyFacts'
import {
  closedRoleDate, closedRoleMeta, closedRoleOwnStatus, coachingRolesPostedLine, isCandidateCoach,
  isRecruitingCoach, recruitingForLine, startOfYearIso,
} from '@/lib/coachRoles'
import { pipelineOf } from '@/lib/clubRecruiting'

const NOW = new Date('2026-10-04T12:00:00Z')

function role(id: string, type: 'player' | 'coach', title: string) {
  return {
    id, title, opportunity_type: type, status: 'open', club_id: 'club-1', world_club_id: null,
    created_at: '2026-09-01T10:00:00Z', gender: 'Men', position: type === 'player' ? 'forward' : null,
    location_city: 'Zagreb', location_country: 'Croatia', benefits: [], eu_passport_required: false,
    application_deadline: null, start_date: null, duration_text: null,
    club: { id: 'club-1', full_name: 'Concordia 1906', avatar_url: null, is_test_account: false, role: 'club', current_club: null },
    world_club: null,
  }
}

const coachProfile = (over: Record<string, unknown> = {}) => ({
  id: 'coach-1', role: 'coach', coach_recruits_for_team: false, notify_opportunities: true,
  career_entry_count: 0, accepted_reference_count: 0, current_club: 'Barnes HC', current_world_club_id: null, ...over,
})

function wrap(node: ReactNode, path = '/opportunities') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  queryClient.clear()
  navigateSpy.mockReset()
  toggleSpy.mockReset()
  phone = true
  pulseMode = 'recruit'
  tables = {}
  myRoles = { loading: false, open: [], closed: [], expiryDays: 14, refresh: () => undefined }
  history = { postedThisYear: null, recentlyClosed: [], loading: false }
  authState = { user: { id: 'coach-1' }, profile: coachProfile() }
})

// ── Opportunities · Roles ───────────────────────────────────────────────────
describe('Opportunities · Roles by viewer', () => {
  const both = [role('r-player', 'player', 'Striker wanted'), role('r-coach', 'coach', 'Head Coach, Men 1st XI')]

  it('a candidate coach sees coaching roles only, with no match, counts or Save', async () => {
    tables = { opportunities: both }
    wrap(<OpportunitiesPage />)
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(1))
    expect(screen.getByText('Head Coach, Men 1st XI')).toBeInTheDocument()
    expect(screen.queryByText('Striker wanted')).toBeNull()
    expect(screen.getByTestId('coach-roles-open-line').textContent).toBe('Coaching roles · 1 open')
    const card = screen.getByTestId('role-card')
    expect(card.textContent).not.toMatch(/fit|match|applicant|save/i)
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    // Roles · Applied — and no My roles for a coach who does not recruit.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Roles', 'Applied'])
  })

  it('a player keeps the whole list and the Open roles | Applied control', async () => {
    authState = { user: { id: 'p1' }, profile: { id: 'p1', role: 'player' } }
    tables = { opportunities: both }
    wrap(<OpportunitiesPage />)
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(2))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Open roles · 2', 'Applied'])
    expect(screen.queryByTestId('coach-roles-open-line')).toBeNull()
  })

  it('a coach who recruits keeps the whole list and gets My roles', async () => {
    authState = { user: { id: 'coach-1' }, profile: coachProfile({ coach_recruits_for_team: true }) }
    tables = { opportunities: both }
    wrap(<OpportunitiesPage />)
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(2))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Roles', 'Applied', 'My roles'])
    expect(screen.queryByTestId('coach-roles-open-line')).toBeNull()
  })

  it('My roles is phone only', async () => {
    phone = false
    authState = { user: { id: 'coach-1' }, profile: coachProfile({ coach_recruits_for_team: true }) }
    tables = { opportunities: both }
    wrap(<OpportunitiesPage />, '/opportunities?view=mine')
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(2))
    expect(screen.queryByTestId('coach-my-roles')).toBeNull()
  })
})

// ── Empty state ─────────────────────────────────────────────────────────────
describe('Opportunities · no coaching role open', () => {
  const closed = [
    { id: 'c1', title: 'Head Coach Wanted', clubName: 'San Vicente', country: 'Spain', closedAt: '2026-09-20T09:00:00Z' },
    { id: 'c2', title: 'Head Coach - Men 1st XI', clubName: 'Concordia 1906', country: 'Croatia', closedAt: '2025-12-02T09:00:00Z' },
  ]

  it('the page shows the empty state when only player roles are open, and the switch writes notify_opportunities', async () => {
    tables = { opportunities: [role('r-player', 'player', 'Striker wanted')] }
    history = { postedThisYear: 4, recentlyClosed: closed, loading: false }
    wrap(<OpportunitiesPage />)
    await waitFor(() => expect(screen.getByTestId('coach-roles-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('role-card')).toBeNull()
    expect(screen.getByText('No coaching roles open right now')).toBeInTheDocument()
    expect(screen.getByTestId('coach-roles-posted-line').textContent).toBe('4 coaching roles were posted on Hockia this year')
    expect(screen.getByTestId('coach-roles-open-line').textContent).toBe('Coaching roles · 0 open')
    const alerts = screen.getByRole('switch', { name: 'Coaching role alerts' })
    expect(alerts).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(alerts)
    expect(toggleSpy).toHaveBeenCalledWith('notify_opportunities', true)
    fireEvent.click(screen.getByTestId('coach-ready-career'))
    expect(navigateSpy).toHaveBeenCalledWith('/dashboard/profile/journey')
    fireEvent.click(screen.getByTestId('coach-ready-reference'))
    expect(navigateSpy).toHaveBeenCalledWith('/dashboard/profile/references')
  })

  const base = {
    postedThisYear: 4, recentlyClosed: closed, ownStatuses: {}, careerEntryCount: 0, acceptedReferenceCount: 0,
    alertsOn: false, onToggleAlerts: vi.fn(), onAddCareer: vi.fn(), onAskReference: vi.fn(), onOpenRole: vi.fn(), now: NOW,
  }

  it('the year line hides when the count is unreadable or 0', () => {
    const { rerender } = render(<CoachRolesEmptyState {...base} postedThisYear={null} />)
    expect(screen.queryByTestId('coach-roles-posted-line')).toBeNull()
    rerender(<CoachRolesEmptyState {...base} postedThisYear={0} />)
    expect(screen.queryByTestId('coach-roles-posted-line')).toBeNull()
    rerender(<CoachRolesEmptyState {...base} postedThisYear={1} />)
    expect(screen.getByTestId('coach-roles-posted-line').textContent).toBe('1 coaching role was posted on Hockia this year')
    expect(coachingRolesPostedLine(Number.NaN)).toBeNull()
  })

  it('"Be ready" rows show only while career / references are missing', () => {
    const { rerender } = render(<CoachRolesEmptyState {...base} />)
    expect(screen.getByText('Add your coaching career')).toBeInTheDocument()
    expect(screen.getByText('Ask for a reference')).toBeInTheDocument()
    rerender(<CoachRolesEmptyState {...base} careerEntryCount={2} />)
    expect(screen.queryByText('Add your coaching career')).toBeNull()
    expect(screen.getByText('Ask for a reference')).toBeInTheDocument()
    rerender(<CoachRolesEmptyState {...base} careerEntryCount={2} acceptedReferenceCount={1} />)
    expect(screen.queryByTestId('coach-be-ready')).toBeNull()
  })

  it('recently closed: title, club · country, day-first date; own status grey, never amber', () => {
    render(<CoachRolesEmptyState {...base} ownStatuses={{ c1: 'rejected', c2: 'no_response' }} />)
    const rows = screen.getAllByTestId('coach-closed-role')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Head Coach Wanted')
    expect(rows[0].textContent).toContain('San Vicente · Spain · Closed 20 Sep')
    expect(rows[1].textContent).toContain('Concordia 1906 · Croatia · Closed 2 Dec 2025')
    const pills = screen.getAllByTestId('coach-closed-role-status')
    expect(pills.map((p) => p.textContent)).toEqual(['Not selected', 'No reply'])
    for (const p of pills) {
      expect(p.className).toContain('text-ink-2')
      expect(p.className).not.toMatch(/amber|fdf1e4|red|rose/)
    }
    expect(screen.queryByText('Declined')).toBeNull()
    fireEvent.click(rows[0])
    expect(base.onOpenRole).toHaveBeenCalledWith('c1')
  })

  it('no pill on a closed role the coach did not apply to; no switch state leak', () => {
    render(<CoachRolesEmptyState {...base} />)
    expect(screen.queryByTestId('coach-closed-role-status')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Coaching role alerts' })).toHaveAttribute('aria-checked', 'false')
  })

  it('helpers', () => {
    expect(closedRoleOwnStatus('pending')).toBe('Role closed')
    expect(closedRoleOwnStatus(undefined)).toBeNull()
    expect(closedRoleMeta({ clubName: 'San Vicente', country: null })).toBe('San Vicente')
    expect(closedRoleDate(null, NOW)).toBeNull()
    expect(startOfYearIso(NOW)).toBe('2026-01-01T00:00:00.000Z')
    expect(isCandidateCoach({ role: 'coach', coach_recruits_for_team: null })).toBe(true)
    expect(isCandidateCoach({ role: 'player' })).toBe(false)
    expect(isRecruitingCoach({ role: 'coach', coach_recruits_for_team: true })).toBe(true)
    expect(isRecruitingCoach({ role: 'club' })).toBe(false)
  })
})

// ── My roles ────────────────────────────────────────────────────────────────
describe('Opportunities · My roles (coach who recruits)', () => {
  const ownRole = (statuses: string[]) => ({
    ...role('own-1', 'player', 'Women’s 1s'),
    club_id: 'coach-1',
    pipeline: pipelineOf(statuses as never),
    pendingAppliedAt: statuses.filter((s) => s === 'pending').map(() => '2026-09-25T10:00:00Z'),
  })
  const props = { profile: { id: 'coach-1', current_world_club_id: null, current_club: 'Barnes HC' }, onPostRole: vi.fn(), onEditRole: vi.fn() }

  it('"Recruiting for <club>", the waiting notice, the pipeline and ONE Primary', () => {
    myRoles = { ...myRoles, open: [ownRole(['pending', 'pending', 'pending', 'rejected'])] }
    wrap(<CoachMyRoles {...props} data={myRoles as never} />)
    expect(screen.getByTestId('coach-recruiting-for').textContent).toBe('Recruiting for Barnes HC')
    expect(screen.getByTestId('club-waiting-notice').textContent).toContain('3 applicants waiting for a reply')
    const card = screen.getByTestId('club-role-card')
    expect(card.textContent).toContain('To review')
    const primaries = Array.from(document.querySelectorAll('button')).filter((b) => b.className.includes('bg-hockia-primary'))
    expect(primaries).toHaveLength(1)
    expect(primaries[0].textContent).toBe('Review 3 applicants')
    const group = screen.getByTestId('club-scouting-group')
    expect(group.textContent).toContain('Find players for this role')
    expect(group.textContent).toContain('Shortlist')
    // No Open / Closed control until a closed role exists.
    expect(screen.queryByRole('tablist', { name: 'Role status' })).toBeNull()
    fireEvent.click(primaries[0])
    expect(navigateSpy).toHaveBeenCalledWith('/dashboard/opportunities/own-1/applicants', { state: { from: '/opportunities?view=mine' } })
  })

  it('no reply owed → no amber notice and no Primary', () => {
    myRoles = { ...myRoles, open: [ownRole(['shortlisted'])] }
    wrap(<CoachMyRoles {...props} data={myRoles as never} />)
    expect(screen.queryByTestId('club-waiting-notice')).toBeNull()
    expect(Array.from(document.querySelectorAll('button')).filter((b) => b.className.includes('bg-hockia-primary'))).toHaveLength(0)
    expect(screen.getByText('View applicants')).toBeInTheDocument()
  })

  it('the linked world club names the team; the typed club is the fallback', async () => {
    tables = { world_clubs: [{ club_name: 'Barnes Hockey Club' }] }
    myRoles = { ...myRoles, open: [ownRole([])] }
    wrap(<CoachMyRoles {...props} profile={{ id: 'coach-1', current_world_club_id: 'wc-1', current_club: 'Barnes HC' }} data={myRoles as never} />)
    await waitFor(() => expect(screen.getByTestId('coach-recruiting-for').textContent).toBe('Recruiting for Barnes Hockey Club'))
    expect(recruitingForLine(null, ' Barnes HC ')).toBe('Recruiting for Barnes HC')
    expect(recruitingForLine(null, null)).toBeNull()
  })

  it('the page opens My roles for a recruiting coach (segment with the open count) and hides the list', async () => {
    authState = { user: { id: 'coach-1' }, profile: coachProfile({ coach_recruits_for_team: true }) }
    tables = { opportunities: [role('r-coach', 'coach', 'Head Coach, Men 1st XI')] }
    myRoles = { ...myRoles, open: [ownRole(['pending'])] }
    wrap(<OpportunitiesPage />)
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(1))
    fireEvent.click(screen.getByRole('tab', { name: 'My roles · 1' }))
    await waitFor(() => expect(screen.getByTestId('coach-my-roles')).toBeInTheDocument())
    expect(screen.queryByTestId('role-card')).toBeNull()
    expect(screen.getByTestId('coach-recruiting-for').textContent).toBe('Recruiting for Barnes HC')
    expect(screen.getByText('Review 1 applicant')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Post a role' }))
    expect(screen.getByTestId('create-role-modal')).toBeInTheDocument()
  })

  it('a candidate coach cannot reach My roles by URL', async () => {
    tables = { opportunities: [role('r-coach', 'coach', 'Head Coach, Men 1st XI')] }
    wrap(<OpportunitiesPage />, '/opportunities?view=mine')
    await waitFor(() => expect(screen.getAllByTestId('role-card')).toHaveLength(1))
    expect(screen.queryByTestId('coach-my-roles')).toBeNull()
  })
})

// ── Home · Your week ────────────────────────────────────────────────────────
describe('Home · Your week for a coach', () => {
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('.text-caption')).map((n) => n.textContent)

  it('a coach who recruits gets the club version, linking to My roles', () => {
    authState = { user: { id: 'coach-1' }, profile: coachProfile({ coach_recruits_for_team: true }) }
    const { container } = render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(labels(container)).toEqual(['to review', 'profile views', 'open role'])
    expect(screen.getByTestId('your-week-0').getAttribute('href')).toBe('/opportunities?view=mine')
    expect(screen.getByTestId('your-week-0').querySelector('.text-figure')?.className).toContain('text-hockia-primary')
  })

  it('a coach who does not recruit gets the player version, whatever the stored mode', () => {
    pulseMode = 'recruit'
    const { container } = render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(labels(container)).toEqual(['profile views', 'roles for you', 'club replies'])
  })

  it('a recruiting coach on "find" mode, or on desktop, gets the player version', () => {
    authState = { user: { id: 'coach-1' }, profile: coachProfile({ coach_recruits_for_team: true }) }
    pulseMode = 'find'
    const first = render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(labels(first.container)).toEqual(['profile views', 'roles for you', 'club replies'])
    first.unmount()
    pulseMode = 'recruit'
    phone = false
    const second = render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(labels(second.container)).toEqual(['roles for you', 'profile views', 'club replies'])
  })
})

// ── Key facts ───────────────────────────────────────────────────────────────
describe('Coach key facts (D6.1)', () => {
  const byId = <T extends { id: string }>(facts: T[], id: string) => facts.find((f) => f.id === id) as T

  it('maps the six facts in the Figma order', () => {
    const facts = buildCoachKeyFacts({
      specialization: 'other', specializationCustom: 'Drag-flick coach', categories: [],
      currentRole: 'Head coach', currentClubName: 'Club Atlético Pacífico', openToCoach: true,
      availableFrom: '2027-01-04', relocationWillingness: 'relocate',
      passports: [{ name: 'Argentina', flag: '🇦🇷', isEu: false }], age: 34,
    }, { viewer: 'recruiter', today: NOW })
    expect(facts.map((f) => f.label)).toEqual(['Specialization', 'Coaches at', 'Available', 'Passport', 'Categories', 'Age'])
    expect(byId(facts, 'specialization').value).toBe('Drag-flick coach')
    expect(byId(facts, 'coaches_at')).toMatchObject({ value: 'Club Atlético Pacífico', detail: 'Head coach · current role' })
    expect(byId(facts, 'available')).toMatchObject({ value: 'From 4 Jan 2027', detail: 'Open to relocating' })
    expect(byId(facts, 'passport')).toMatchObject({ value: '🇦🇷 Argentina', detail: 'No EU passport' })
    expect(byId(facts, 'categories').value).toBe('Any category')
    expect(byId(facts, 'age').value).toBe('34')
  })

  it('two passports, one of them EU', () => {
    const facts = buildCoachKeyFacts({
      specialization: 'head_coach', categories: ['adult_women'], currentRole: null, currentClubName: null, openToCoach: false,
      availableFrom: null, passports: [{ name: 'Argentina', isEu: false }, { name: 'Italy', isEu: true }], age: 40,
    }, { viewer: 'public', today: NOW })
    expect(byId(facts, 'passport')).toMatchObject({ value: 'Argentina · Italy', detail: 'EU passport' })
  })

  it('empty facts read "Not given" and are never hidden', () => {
    const facts = buildCoachKeyFacts({
      specialization: null, categories: null, currentRole: null, currentClubName: null, openToCoach: null,
      availableFrom: null, passports: [], age: null,
    }, { viewer: 'recruiter', today: NOW })
    expect(facts).toHaveLength(6)
    expect(facts.filter((f) => f.id !== 'categories').map((f) => f.value)).toEqual([NOT_GIVEN, NOT_GIVEN, NOT_GIVEN, NOT_GIVEN, NOT_GIVEN])
    expect(byId(facts, 'categories').value).toBe('Any category')
    expect(facts.every((f) => f.action === null)).toBe(true)
  })
})
