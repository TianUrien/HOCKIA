import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Vacancy } from '@/lib/supabase'

/**
 * Round 5: fit counts position (Position row), "Find … for this role" in the
 * role menu, video counts that match the profile, one "posted" date and a real
 * applications window, the real status on the desktop preview, club greetings,
 * the filled toast, closed-role copy, the decline sparkle, shared desktop
 * wording, published-only Open count, header dots and the chat header league.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
const invoke = vi.fn()
const navigateSpy = vi.fn()
const activateForOpportunity = vi.fn()
let segmentDots = { messages: false, requests: false, activity: false }
let authState: { user: { id: string } | null; profile: Record<string, unknown> | null } = { user: null, profile: null }

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})
vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const result = () => Promise.resolve({ data: null, count: 0, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'update']) chain[m] = () => chain
    chain.maybeSingle = result
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  return { supabase: { from: () => builder(), rpc: vi.fn(), functions: { invoke: (...a: unknown[]) => invoke(...a) } } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: unknown) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/hooks/useRecruitingContext', () => ({
  useRecruitingContext: () => ({ activateForOpportunity }),
  opportunityGenderToTarget: (g: string | null | undefined) => (g === 'Men' ? 'Men' : g === 'Women' ? 'Women' : null),
}))
vi.mock('@/hooks/useInboxSegmentDots', () => ({ useInboxSegmentDots: () => segmentDots }))
vi.mock('@/hooks/useNavigation', () => ({
  useNavigation: () => ({
    user: authState.user,
    profile: authState.profile,
    isActive: () => false,
    handleNavigate: navigateSpy,
    toggleNotificationDrawer: vi.fn(),
    unreadCount: 12,
    opportunityCount: 3,
    notificationCount: 2,
  }),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => undefined }))
vi.mock('@/components/index', () => ({
  Avatar: () => <div data-testid="avatar" />,
  StorageImage: () => <div data-testid="storage-image" />,
  AvatarMenu: () => null,
}))
vi.mock('@/components/ApplicationTimeline', () => ({ default: () => null }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { fitPositionRow, fitRows, appliedSinceLine } from '@/lib/clubRecruiting'
import { RoleActions } from '@/components/club/RoleActions'
import { DeclineSheet } from '@/components/club/DeclineSheet'
import OpportunityDetailView from '@/components/OpportunityDetailView'
import Header from '@/components/Header'
import { closeRoleToast, REOPEN_ROLE_TOAST, CLOSE_NOT_FILLED_LABEL } from '@/lib/roleLifecycle'
import { postedLine, rolePostedAt } from '@/lib/opportunityCopy'
import { greetingName } from '@/lib/profile'
import { clubLeadLeague, clubLeagueLine } from '@/lib/clubProfileCopy'
import { applyFindFilters, rankScoutRows, rowFullMatches, type ScoutRow } from '@/lib/findPlayers'
import { profileVideoTotal } from '@/hooks/useProfileVideoTotal'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8')

beforeEach(() => {
  invoke.mockReset()
  navigateSpy.mockReset()
  activateForOpportunity.mockReset()
  activateForOpportunity.mockResolvedValue(null)
  segmentDots = { messages: false, requests: false, activity: false }
  authState = { user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club', full_name: 'E2E Test FC' } }
})

// ── A. Position row ─────────────────────────────────────────────────────────
describe('fit: Position row', () => {
  const ctx = { roleGender: 'Men', playerCategoryLabel: 'Adult men', firstName: 'Ana', lastActiveDays: 0, playerClub: null, playerLeagueKnown: false, clubLeagueKnown: false }

  it('wrong position names both sides; never ticked', () => {
    const row = fitPositionRow({ position_match: 0, role_position: 'goalkeeper', candidate_position: 'midfielder' })
    expect(row).toEqual({ key: 'position', label: 'Position', ok: false, detail: 'Midfielder — the role is for a Goalkeeper' })
  })
  it('primary match is ticked', () => {
    expect(fitPositionRow({ position_match: 1, role_position: 'goalkeeper', candidate_position: 'goalkeeper' })?.detail).toBe('Plays Goalkeeper — matches')
    expect(fitPositionRow({ position_match: 1, role_position: 'goalkeeper', candidate_position: 'goalkeeper' })?.ok).toBe(true)
  })
  it('secondary match and no position are explained, not ticked', () => {
    const second = fitPositionRow({ position_match: 0.5, role_position: 'goalkeeper', candidate_position: 'defender', candidate_secondary_position: 'goalkeeper' })
    expect(second?.detail).toBe('Defender — plays Goalkeeper as a second position')
    expect(second?.ok).toBe(false)
    expect(fitPositionRow({ position_match: 0, role_position: 'goalkeeper', candidate_position: null })?.detail).toBe('No position on the profile yet — the role is for a Goalkeeper')
  })
  it('coach roles use the coach vocabulary', () => {
    expect(fitPositionRow({ position_match: 0, role_position: 'head_coach', candidate_position: 'assistant_coach' })?.detail).toBe('Assistant coach — the role is for a Head coach')
    expect(fitPositionRow({ position_match: 0, role_position: 'other_coach', candidate_position: 'head_coach' })?.detail).toBe('Head coach — the role is for a Other')
  })
  it('comes first when the role has a position; absent otherwise (old cache rows too)', () => {
    const withPos = fitRows({ gender_match: 1, position_match: 0, role_position: 'goalkeeper', candidate_position: 'forward' }, ctx)
    expect(withPos.map((r) => r.key)).toEqual(['position', 'category', 'open', 'active', 'level'])
    expect(fitRows({ gender_match: 1 }, ctx).map((r) => r.key)).toEqual(['category', 'open', 'active', 'level'])
  })
  it('gender-neutral copy (no pronouns)', () => {
    const all = [0, 0.5, 1].map((m) => fitPositionRow({ position_match: m, role_position: 'goalkeeper', candidate_position: 'forward' })?.detail ?? '').join(' ')
    expect(all).not.toMatch(/\b(his|her|him|she|he)\b/i)
  })
  it('the migration caps the fit and keeps the guard', () => {
    const sql = read('../../../supabase/migrations/20260930100000_club_fit_position.sql')
    expect(sql).toContain("IF NOT public.is_recruiter(auth.uid()) THEN")
    expect(sql).toContain('v_score := LEAST(v_score, 0.65);')
    expect(sql).toContain("SET search_path TO 'public'")
    expect(sql).toContain('DELETE FROM public.club_fit_cache;')
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.compute_club_fit\(uuid, uuid, text, text, uuid\) TO authenticated;/)
    expect(sql).not.toMatch(/TO anon/)
  })
})

// ── B. Find … for this role in the "…" menu ─────────────────────────────────
function renderRoleActions(role: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RoleActions role={{ id: 'r1', club_id: 'club-1', status: 'open', title: 'Goalkeeper', application_deadline: null, ...role } as never} onChanged={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('role menu: Find players / coaches for this role', () => {
  it('open player role → activates the role, then Find players for it', async () => {
    renderRoleActions({ opportunity_type: 'player', gender: 'Men', location_city: 'Dublin' })
    fireEvent.click(screen.getByTestId('role-actions-button'))
    const find = screen.getByTestId('role-actions-find')
    expect(find.textContent).toContain('Find players for this role')
    fireEvent.click(find)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/dashboard/find-players?role=r1'))
    expect(activateForOpportunity).toHaveBeenCalledWith({ opportunityId: 'r1', target: 'Men', region: 'Dublin', label: 'Goalkeeper' })
  })
  it('open coach role → Find coaches for this role → Community coaches', async () => {
    renderRoleActions({ opportunity_type: 'coach', gender: 'Women' })
    fireEvent.click(screen.getByTestId('role-actions-button'))
    const find = screen.getByTestId('role-actions-find')
    expect(find.textContent).toContain('Find coaches for this role')
    fireEvent.click(find)
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/community/coaches'))
    expect(activateForOpportunity).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'r1', target: null }))
  })
  it('closed roles have no Find', () => {
    renderRoleActions({ status: 'closed', opportunity_type: 'player' })
    fireEvent.click(screen.getByTestId('role-actions-button'))
    expect(screen.queryByTestId('role-actions-find')).toBeNull()
    expect(screen.getByText('Reopen role')).toBeTruthy()
  })
  it('Role posted reuses the same activation', () => {
    expect(read('../components/club/RolePostedScreen.tsx')).toContain("useFindForRole")
  })
})

// ── C1. Video counts = the profile's tiles ──────────────────────────────────
describe('video counts match the profile', () => {
  const base = { fitScore: null, highlights: 0, career_entry_count: 0, last_active_at: null } as unknown as ScoutRow
  it('full matches = linked + uploaded (3, not 1)', () => {
    expect(rowFullMatches({ ...base, full_game_video_count: 1, fullMatches: 3 })).toBe(3)
    expect(rowFullMatches({ ...base, full_game_video_count: 1 })).toBe(1)
  })
  it('ranking and the Full match filter use the same number', () => {
    const uploadedOnly = { ...base, id: 'a', full_game_video_count: 0, fullMatches: 2, open_to_play: true, nationality_country_id: null, nationality2_country_id: null, applicationId: null } as ScoutRow
    const linked = { ...base, id: 'b', full_game_video_count: 1, fullMatches: 1, open_to_play: true, nationality_country_id: null, nationality2_country_id: null, applicationId: null } as ScoutRow
    expect(rankScoutRows([linked, uploadedOnly], { byFit: false }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(applyFindFilters([uploadedOnly], new Set(['full_match']), new Set()).length).toBe(1)
  })
  it('applicant review "See all" counts every tile (reels + legacy link too) — 6, not 5', () => {
    expect(profileVideoTotal({ videoRows: 2 + 2 + 1, fullGameLinks: 1, hasLegacyHighlight: false, lockedFullMatches: 0, lockedHighlights: 0 })).toBe(6)
    expect(read('../components/club/ApplicantReviewScreen.tsx')).toContain('scroll.reels.length')
  })
})

// ── C2. Dates ───────────────────────────────────────────────────────────────
describe('dates: posted and applied since', () => {
  const md = (iso: string) => new Date(iso).toISOString().slice(5, 10)
  it('"applied since" is the first application, not the (re-stamped) published date', () => {
    expect(appliedSinceLine([{ status: 'pending', appliedAt: '2026-09-27T10:00:00Z' }], md)).toBe('1 applied since 09-27')
    // D4 re-check (2026-10-02): a withdrawn applicant did apply, so it counts (it shows under Closed).
    expect(appliedSinceLine([
      { status: 'withdrawn', appliedAt: '2026-08-01T00:00:00Z' },
      { status: 'rejected', appliedAt: '2026-09-02T00:00:00Z' },
      { status: 'pending', appliedAt: '2026-09-20T00:00:00Z' },
    ], md)).toBe('3 applied since 08-01')
    expect(appliedSinceLine([], md)).toBe('No applicants yet')
  })
  it('both sides use created_at for "posted"', () => {
    expect(rolePostedAt({ created_at: '2026-06-04T00:00:00Z' } as Vacancy)).toBe('2026-06-04T00:00:00Z')
    const club = read('../components/club/ClubOpportunitiesScreen.tsx')
    expect(club).toContain('rolePostedAt(role)')
    expect(club).not.toContain('published_at ?? role.created_at')
    expect(read('../components/club/ApplicantsScreen.tsx')).not.toContain('published_at')
  })
})

// ── C3. Desktop preview: real status + Message the club ─────────────────────
const openVacancy = {
  id: 'opp-1', club_id: 'club-9', title: 'Midfielder', opportunity_type: 'player', position: 'midfielder', gender: 'Men',
  status: 'open', priority: 'medium', location_city: 'Dublin', location_country: 'Ireland', created_at: '2026-09-01T00:00:00Z',
  application_deadline: '2026-12-01', start_date: null, duration_text: null, benefits: [], custom_benefits: [],
  specialist_skills_wanted: [], requirements: [], description: null, compensation: null, eu_passport_required: false,
} as unknown as Vacancy

describe('desktop preview on an open role the viewer applied to', () => {
  it('shows the real status (No reply), not "Application Submitted", and Message the club', () => {
    authState = { user: { id: 'p1' }, profile: { id: 'p1', role: 'player' } }
    const onMessage = vi.fn()
    render(
      <MemoryRouter>
        <OpportunityDetailView vacancy={openVacancy} clubName="Club" clubId="club-9" publisherRole="club" onClose={() => {}} hasApplied applicationStatus="no_response" onMessage={onMessage} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Application Submitted')).toBeNull()
    expect(screen.getByTestId('own-application-status').textContent).toBe('No reply')
    fireEvent.click(screen.getByTestId('open-message-club'))
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
  it('a closed role hides its deadline', () => {
    authState = { user: { id: 'p1' }, profile: { id: 'p1', role: 'player' } }
    render(
      <MemoryRouter>
        <OpportunityDetailView vacancy={{ ...openVacancy, status: 'closed' } as Vacancy} clubName="Club" clubId="club-9" publisherRole="club" onClose={() => {}} isClosed />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Application Deadline')).toBeNull()
  })
  it('the Opportunities list passes the viewer\'s own status to the preview', () => {
    expect(read('../pages/OpportunitiesPage.tsx')).toContain('applicationStatus={applicationStatuses[previewVacancy.id] ?? null}')
  })
})

// ── C4. Greeting ────────────────────────────────────────────────────────────
describe('Hockia AI greeting', () => {
  it('clubs by their whole name; people by first name', () => {
    expect(greetingName({ role: 'club', full_name: 'E2E Test FC' })).toBe('E2E Test FC')
    expect(greetingName({ role: 'player', full_name: 'Ana María López' })).toBe('Ana')
    expect(greetingName({ role: 'coach', full_name: '  ' })).toBeNull()
    expect(greetingName(null)).toBeNull()
  })
})

// ── C5 / C8. Toasts and shared wording ──────────────────────────────────────
describe('close / reopen copy', () => {
  it('"Applicants have been told." only when some were waiting', () => {
    expect(closeRoleToast('filled', 0)).toBe('Role closed as filled.')
    expect(closeRoleToast('filled')).toBe('Role closed as filled.')
    expect(closeRoleToast('filled', 3)).toBe('Role closed as filled. Applicants have been told.')
    expect(closeRoleToast('withdrawn', 3)).toBe('Role closed.')
  })
  it('desktop uses the phone wording', () => {
    expect(REOPEN_ROLE_TOAST).toBe('Role reopened.')
    expect(CLOSE_NOT_FILLED_LABEL).toBe('Not filled / no longer needed')
    const desktop = read('../components/OpportunitiesTab.tsx')
    expect(desktop).not.toContain('Opportunity reopened.')
    expect(desktop).not.toContain('Just closing')
    expect(desktop).toContain('closeRoleToast(reason, waiting)')
  })
})

// ── C6. Closed role copy ────────────────────────────────────────────────────
describe('closed role pages', () => {
  it('no "closes when filled" on a closed role', () => {
    const now = new Date('2026-09-27T12:00:00Z')
    const v = { created_at: '2026-09-24T12:00:00Z', application_deadline: null, closed_at: '2026-09-26T12:00:00Z' }
    expect(postedLine(v, now)).toBe('Posted 3 days ago · No deadline — closes when filled')
    // Round 9: day first (lib/dayFirst).
    expect(postedLine(v, now, true)).toMatch(/^Posted 3 days ago · Closed 2[56] Sep 2026$/)
    expect(postedLine({ ...v, closed_at: null }, now, true)).toBe('Posted 3 days ago · Closed')
    const phone = read('../components/opportunities/OpportunityDetailMobile.tsx')
    expect(phone).toContain("!vacancy.compensation && !closed ? 'Ask the club when you apply'")
    expect(phone).toContain("{!closed && askRow('Apply by'")
  })
})

// ── C7. Decline sparkle ─────────────────────────────────────────────────────
describe('decline sheet: sparkle only on the untouched AI draft', () => {
  it('drops the sparkle once the club rewrites the note', async () => {
    invoke.mockResolvedValue({ data: { message: 'Thanks for applying.' }, error: null })
    render(<DeclineSheet open applicationId="a1" firstName="Ana" onCancel={() => {}} onSend={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Timing' }))
    await waitFor(() => expect(screen.getByTestId('decline-note-ai').textContent).toContain('Drafted by Hockia AI'))
    const box = screen.getByLabelText('Note to Ana')
    await act(async () => { fireEvent.change(box, { target: { value: 'Thanks — we went another way.' } }) })
    expect(screen.queryByTestId('decline-note-ai')).toBeNull()
    expect(screen.getByTestId('decline-note-own').textContent).toBe('Your note')
    expect(screen.getByTestId('decline-note-own').querySelector('svg')).toBeNull()
  })
})

// ── C10. Open count ─────────────────────────────────────────────────────────
describe('phone Opportunities: Open counts published roles only', () => {
  it('drafts are listed but not counted', () => {
    const src = read('../components/club/ClubOpportunitiesScreen.tsx')
    expect(src).toContain("const publishedOpen = data.open.filter((r) => r.status === 'open').length")
    expect(src).toContain("{ value: 'open', label: 'Open', count: publishedOpen }")
  })
})

// ── C11. Header dots ────────────────────────────────────────────────────────
describe('desktop header: dots, never numbers', () => {
  it('no counts; Inbox and bell dots follow the phone rules', () => {
    segmentDots = { messages: true, requests: false, activity: false }
    const { container, unmount } = render(<MemoryRouter><Header /></MemoryRouter>)
    expect(container.textContent).not.toMatch(/\b(9\+|12|14|3|2)\b/)
    expect(screen.getAllByTestId('header-unread-dot')).toHaveLength(1) // Inbox only (no Opportunities, no bell)
    unmount()
    segmentDots = { messages: false, requests: false, activity: true }
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getAllByTestId('header-unread-dot')).toHaveLength(2) // Inbox + bell
  })
})

// ── C12. Club logo on the club's own role ───────────────────────────────────
describe('desktop pop-up on the club\'s own role', () => {
  it('uses the club\'s own logo at once (no placeholder while fetching)', () => {
    const src = read('../components/OpportunitiesTab.tsx')
    expect(src).toContain('if (profile && vacancy.club_id === profile.id) {')
    expect(src).toContain('setClubLogo(profile.avatar_url ?? null)')
  })
})

// ── C13. Chat header league ─────────────────────────────────────────────────
describe('chat header league = the profile\'s first league', () => {
  it('men first, like the club profile', () => {
    expect(clubLeadLeague('Hockey One League', 'Premier League')).toBe('Hockey One League')
    expect(clubLeadLeague(null, 'Premier League')).toBe('Premier League')
    expect(clubLeadLeague(' ', null)).toBeNull()
    expect(clubLeagueLine('Hockey One League', 'Premier League')?.startsWith('Hockey One League')).toBe(true)
    expect(read('../features/chat-v2/components/ChatHeader.tsx')).toContain('clubLeadLeague(data.mens_league_division, data.womens_league_division)')
  })
})
