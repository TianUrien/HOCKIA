import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { NotificationRecord } from '@/lib/api/notifications'
import {
  checkInCopy,
  clubReplyLine,
  confirmedAgoLine,
  happenedLinesFromNotification,
  happenedTimeline,
  newRolesLine,
  recruitersLine,
  viewerLines,
  viewersHeadline,
  viewsDeltaLine,
  weekRangeLabel,
  type WeekViewerRow,
} from '@/lib/pulseWeek'

/**
 * Your week v2 (Pulse, Figma 42:276; founder rulings 2026-10-03):
 *  - header copy: plural / singular / zero, gender-neutral;
 *  - the check-in confirms through confirm_availability and "Not right now"
 *    goes down the Open to play switch's path (open: false);
 *  - "Who looked at you" masks anonymous viewers and never lists players;
 *  - every "What happened" line is grey — an expired application is never amber;
 *  - zero views: headline line, tiles at 0, viewers section hidden, check-in kept.
 */

// ── mocks ────────────────────────────────────────────────────────────────
const rpc = vi.fn()
const profileUpdate = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ update: (...args: unknown[]) => { profileUpdate(...args); return { eq: () => Promise.resolve({ error: null }) } } }),
  },
}))

type AuthProfile = {
  id: string
  role: string
  position: string | null
  coach_specialization?: string | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  coach_recruits_for_team: boolean | null
  availability_confirmed_at: string | null
  available_from: string | null
  is_test_account: boolean
}
const authState: { user: { id: string } | null; profile: AuthProfile | null; setProfile: (p: AuthProfile) => void } = {
  user: { id: 'me' },
  profile: null,
  setProfile: (p) => { authState.profile = p },
}
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign((selector: (s: typeof authState) => unknown) => selector(authState), { getState: () => authState }),
}))

const otpSave = vi.fn()
vi.mock('@/hooks/useOpenToPlay', () => ({ useOpenToPlay: () => ({ save: otpSave }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [], loading: false, error: null, getCountryById: (id: number | null) => (id === 1 ? { flag_emoji: '🇦🇷' } : undefined), getCountryByCode: () => undefined, isEuCountry: () => false }),
}))

const visibility = { loading: false, visibility: { views_7d: 0, views_prior_7d: 0, unique_viewers_7d: 0, previews_7d: 0, previews_prior_7d: 0, viewers_by_role: {} as Record<string, number> }, streakDays: 0 }
vi.mock('@/hooks/useWeeklyVisibility', () => ({ useWeeklyVisibility: () => visibility }))
const weekViewers: { viewers: WeekViewerRow[]; loading: boolean } = { viewers: [], loading: false }
vi.mock('@/hooks/useYourWeek', () => ({
  useWeekViewers: () => weekViewers,
  useNewRolesThisWeek: () => ({ roles: { total: 0, forPosition: 0 }, loading: false }),
}))
vi.mock('@/hooks/useMyApplications', () => ({ useMyApplications: () => ({ applications: [], loading: false }) }))
vi.mock('@/hooks/useMyApplicationsAll', () => ({ useMyApplicationsAll: () => ({ rows: [], loading: false, refresh: vi.fn() }) }))
vi.mock('@/hooks/useTrustedReferences', () => ({ useTrustedReferences: () => ({ acceptedReferences: [], acceptedCount: 0 }) }))
vi.mock('@/lib/notifications', () => ({ useNotificationStore: (sel: (s: { notifications: NotificationRecord[] }) => unknown) => sel({ notifications: [] }) }))

import { CheckInCard } from '@/components/pulse/CheckInCard'
import { WhoLookedAtYou } from '@/components/pulse/WhoLookedAtYou'
import { WhatHappened } from '@/components/pulse/WhatHappened'
import { YourWeekScreen } from '@/components/pulse/YourWeekScreen'

const THREE_WEEKS_AGO = new Date(Date.now() - 21 * 86_400_000).toISOString()
const player = (over: Partial<AuthProfile> = {}): AuthProfile => ({
  id: 'me', role: 'player', position: 'midfielder', open_to_play: true, open_to_coach: null, coach_recruits_for_team: null,
  availability_confirmed_at: THREE_WEEKS_AGO, available_from: null, is_test_account: false, ...over,
})

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null })
  otpSave.mockReset().mockResolvedValue({ ok: true, outcome: 'saved', confirmedAt: null })
  profileUpdate.mockReset()
  authState.profile = player()
  visibility.loading = false
  visibility.visibility = { views_7d: 0, views_prior_7d: 0, unique_viewers_7d: 0, previews_7d: 0, previews_prior_7d: 0, viewers_by_role: {} }
  weekViewers.viewers = []
})

const AMBER = /amber|yellow|#b45309|#fdf1e4/i

// ── header copy ──────────────────────────────────────────────────────────
describe('Your week header copy', () => {
  it('names clubs and coaches with the right plurals', () => {
    expect(viewersHeadline({ views: 12, uniqueViewers: 5, clubs: 3, coaches: 1 })).toBe('3 clubs and 1 coach looked at your profile this week')
    expect(viewersHeadline({ views: 2, uniqueViewers: 2, clubs: 1, coaches: 0 })).toBe('1 club looked at your profile this week')
    expect(viewersHeadline({ views: 4, uniqueViewers: 2, clubs: 0, coaches: 2 })).toBe('2 coaches looked at your profile this week')
  })
  it('counts players as people, never by name, and has a zero line', () => {
    expect(viewersHeadline({ views: 3, uniqueViewers: 2, clubs: 0, coaches: 0 })).toBe('2 people looked at your profile this week')
    expect(viewersHeadline({ views: 1, uniqueViewers: 1, clubs: 0, coaches: 0 })).toBe('1 person looked at your profile this week')
    expect(viewersHeadline({ views: 0, uniqueViewers: 0, clubs: 0, coaches: 0 })).toBe('No profile views yet this week')
  })
  it('labels the Monday–Sunday week day first', () => {
    expect(weekRangeLabel(new Date(2026, 8, 16))).toBe('14–20 September')
    expect(weekRangeLabel(new Date(2026, 8, 13))).toBe('7–13 September') // a Sunday belongs to the week before
    expect(weekRangeLabel(new Date(2026, 8, 30))).toBe('28 September – 4 October')
  })
  it('tile sub-lines', () => {
    expect(viewsDeltaLine(12, 8)).toBe('4 more vs last week')
    expect(viewsDeltaLine(3, 5)).toBe('2 fewer vs last week')
    expect(viewsDeltaLine(0, 0)).toBe('Same as last week')
    expect(recruitersLine(3, 1)).toBe('3 clubs · 1 coach')
    expect(recruitersLine(0, 0)).toBe('None yet')
    expect(newRolesLine(2, 'midfielder')).toBe('2 for midfielders')
    expect(newRolesLine(0, 'goalkeeper')).toBe('None for goalkeepers')
    expect(newRolesLine(2, null)).toBe('Open this week')
    expect(clubReplyLine(['Club Atlético'])).toBe('Club Atlético')
    expect(clubReplyLine(['A', 'B', 'C'])).toBe('A and 2 more')
    expect(clubReplyLine([])).toBe('No replies yet')
  })
  it('"You last confirmed" reads weeks, days and never-yet', () => {
    const now = new Date(2026, 9, 3)
    expect(confirmedAgoLine(new Date(2026, 8, 12).toISOString(), now)).toBe('You last confirmed 3 weeks ago.')
    expect(confirmedAgoLine(new Date(2026, 9, 1).toISOString(), now)).toBe('You last confirmed 2 days ago.')
    expect(confirmedAgoLine(null, now)).toBe('You haven’t confirmed yet.')
  })
  it('no gendered pronouns anywhere in the copy', () => {
    const lines = [
      viewersHeadline({ views: 12, uniqueViewers: 5, clubs: 3, coaches: 1 }),
      confirmedAgoLine(null),
      checkInCopy('player', { openToPlay: true, openToCoach: false, recruitsForTeam: false })?.rationale ?? '',
    ]
    for (const l of lines) expect(l).not.toMatch(/\b(his|her|him|he|she)\b/i)
  })
})

// ── check-in ─────────────────────────────────────────────────────────────
describe('check-in card', () => {
  it('"Yes, I’m open" calls confirm_availability and stamps the profile', async () => {
    render(<MemoryRouter><CheckInCard headline="No profile views yet this week" hasViews={false} viewers={[]} /></MemoryRouter>)
    expect(screen.getByText('Are you still open to play?')).toBeInTheDocument()
    expect(screen.getByTestId('week-headline')).toHaveTextContent('No profile views yet this week')
    expect(screen.queryByTestId('viewer-stack')).not.toBeInTheDocument()
    expect(screen.getByText(/You last confirmed 3 weeks ago\./)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('check-in-yes'))
    await waitFor(() => expect(screen.getByTestId('check-in-confirmed')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('confirm_availability')
    expect(authState.profile?.availability_confirmed_at).not.toBe(THREE_WEEKS_AGO)
  })

  it('"Not right now" turns Open to play off through the switch path, after a purple confirm', async () => {
    render(<MemoryRouter><CheckInCard headline="No profile views yet this week" hasViews={false} viewers={[]} /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('check-in-not-now'))
    expect(screen.getByText('Turn off Open to play?')).toBeInTheDocument()
    const confirm = screen.getByTestId('check-in-off-yes')
    expect(confirm.className).toContain('bg-hockia-primary')
    expect(confirm.className).not.toMatch(/danger/)
    fireEvent.click(confirm)
    await waitFor(() => expect(otpSave).toHaveBeenCalledWith(expect.objectContaining({ open: false })))
    expect(rpc).not.toHaveBeenCalledWith('confirm_availability')
  })

  it('is hidden for a player who is not open, for a recruiting coach and for a club', () => {
    expect(checkInCopy('player', { openToPlay: false, openToCoach: false, recruitsForTeam: false })).toBeNull()
    expect(checkInCopy('coach', { openToPlay: false, openToCoach: true, recruitsForTeam: true })).toBeNull()
    expect(checkInCopy('coach', { openToPlay: false, openToCoach: true, recruitsForTeam: false })?.question).toBe('Still open to coaching opportunities?')
    expect(checkInCopy('club', { openToPlay: false, openToCoach: false, recruitsForTeam: false })).toBeNull()
    authState.profile = player({ open_to_play: false })
    render(<MemoryRouter><CheckInCard headline="2 clubs looked at your profile this week" hasViews viewers={viewerLines(rows)} /></MemoryRouter>)
    // The viewer line (with the avatar stack) stays; only the question goes.
    expect(screen.getByTestId('check-in-viewers-only')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-stack')).toBeInTheDocument()
    expect(screen.queryByTestId('check-in-yes')).not.toBeInTheDocument()
  })
})

// ── who looked at you ────────────────────────────────────────────────────
const rows: WeekViewerRow[] = [
  { viewer_id: 'c1', full_name: 'Club Atlético', role: 'club', username: 'atletico', avatar_url: null, country_id: 1, is_hidden: false, viewed_at: new Date().toISOString() },
  { viewer_id: null, full_name: null, role: null, username: null, avatar_url: null, country_id: null, is_hidden: true, viewed_at: new Date().toISOString() },
  { viewer_id: 'p1', full_name: 'Some Player', role: 'player', username: 'sp', avatar_url: null, country_id: 1, is_hidden: false, viewed_at: new Date().toISOString() },
  { viewer_id: 'k1', full_name: 'Coach Vega', role: 'coach', username: 'vega', avatar_url: null, country_id: null, is_hidden: false, viewed_at: new Date().toISOString() },
]

describe('who looked at you', () => {
  it('masks an anonymous viewer and never lists a player', () => {
    const lines = viewerLines(rows)
    expect(lines.map((l) => l.name)).toEqual(['Club Atlético', 'Private', 'Coach Vega'])
    expect(lines[1]).toMatchObject({ hidden: true, path: null, avatarUrl: null, meta: 'Browsing hidden' })
    expect(lines.some((l) => l.name.includes('Player'))).toBe(false)

    render(<MemoryRouter><WhoLookedAtYou rows={rows} /></MemoryRouter>)
    // Rail: cards without time stamps.
    expect(screen.getByText('Club Atlético')).toBeInTheDocument()
    expect(screen.getByText('Club · 🇦🇷')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Browsing hidden')).toBeInTheDocument()
    expect(screen.queryByText('Some Player')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('viewer-card')).toHaveLength(2)
    expect(screen.getAllByTestId('viewer-card-hidden')).toHaveLength(1)
    expect(screen.queryByTestId('who-looked-list')).not.toBeInTheDocument()
    // See all: the full list with when they looked; still no player.
    fireEvent.click(screen.getByTestId('who-looked-see-all'))
    expect(screen.getAllByTestId('viewer-row')).toHaveLength(2)
    expect(screen.getAllByTestId('viewer-row-hidden')).toHaveLength(1)
    expect(screen.getAllByText('Private')).toHaveLength(2)
    expect(screen.queryByText('Some Player')).not.toBeInTheDocument()
  })
})

// ── what happened / amber rule ───────────────────────────────────────────
function notification(over: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: 'n1', kind: 'applications_expired', sourceEntityId: null, metadata: {}, targetUrl: null,
    createdAt: new Date().toISOString(), readAt: null, seenAt: null, clearedAt: null,
    actor: { id: null, fullName: null, role: null, username: null, avatarUrl: null, baseLocation: null },
    ...over,
  }
}

describe('what happened — amber rule', () => {
  it('an expired application is a neutral grey line that names the role', () => {
    const titles = new Map([['o1', 'Goalkeeper · Serie A1']])
    const lines = happenedLinesFromNotification(notification({ metadata: { opportunity_ids: ['o1'], count: 1 } }), titles)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Your application to Goalkeeper · Serie A1 expired with no reply')
    expect(lines[0].tone).toBe('grey')

    render(<MemoryRouter><WhatHappened lines={lines} /></MemoryRouter>)
    const el = screen.getByTestId('happened-line')
    expect(el.className).not.toMatch(AMBER)
    expect(el.closest('li')?.innerHTML ?? '').not.toMatch(AMBER)
  })
  it('every line kind is grey; inbox-only kinds are left out; old rows drop off', () => {
    const now = new Date()
    const old = new Date(now.getTime() - 10 * 86_400_000).toISOString()
    const list = [
      notification({ id: 'a', kind: 'vacancy_application_status', metadata: { opportunity_title: 'Forward', club_name: 'Club B' } }),
      notification({ id: 'b', kind: 'friend_request_received' }),
      notification({ id: 'c', kind: 'reference_request_accepted', actor: { id: 'x', fullName: 'Dana', role: 'coach', username: null, avatarUrl: null, baseLocation: null } }),
      notification({ id: 'd', kind: 'applications_expired', createdAt: old, metadata: { count: 2 } }),
    ]
    const lines = happenedTimeline(list, new Map(), { now })
    expect(lines.map((l) => l.text)).toEqual(['Club B replied on Forward', 'Dana wrote you a reference'])
    expect(lines.every((l) => l.tone === 'grey')).toBe(true)
  })
})

// ── zero-views state of the whole screen ─────────────────────────────────
describe('Your week screen — zero views', () => {
  it('shows the zero headline, tiles at 0, no viewers section, and keeps the check-in', () => {
    render(<MemoryRouter><YourWeekScreen /></MemoryRouter>)
    expect(screen.getByTestId('week-headline')).toHaveTextContent('No profile views yet this week')
    expect(screen.getByTestId('week-tile-views-value')).toHaveTextContent('0')
    expect(screen.getByTestId('week-tile-recruiters-value')).toHaveTextContent('0')
    expect(screen.getByTestId('week-tile-roles-value')).toHaveTextContent('0')
    expect(screen.getByTestId('week-tile-replies-value')).toHaveTextContent('0')
    expect(screen.getByTestId('week-tile-roles-sub')).toHaveTextContent('None for midfielders')
    expect(screen.getByTestId('week-tile-views-sub').className).not.toMatch(/positive/)
    expect(screen.queryByTestId('who-looked')).not.toBeInTheDocument()
    expect(screen.getByTestId('check-in-card')).toBeInTheDocument()
    expect(screen.queryByTestId('viewer-stack')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your week' })).toBeInTheDocument()
    expect(screen.getByTestId('week-range')).toHaveTextContent(/^\d+(–\d+)? [A-Z][a-z]+/)
  })

  it('with views, names the recruiters and lists them', () => {
    visibility.visibility = { views_7d: 12, views_prior_7d: 8, unique_viewers_7d: 5, previews_7d: 0, previews_prior_7d: 0, viewers_by_role: { club: 3, coach: 1, player: 1 } }
    weekViewers.viewers = rows
    render(<MemoryRouter><YourWeekScreen /></MemoryRouter>)
    expect(screen.getByTestId('week-headline')).toHaveTextContent('3 clubs and 1 coach looked at your profile this week')
    expect(screen.getByTestId('week-tile-views-sub')).toHaveTextContent('4 more vs last week')
    expect(screen.getByTestId('week-tile-views-sub').className).toMatch(/text-status-positive/)
    expect(screen.getByTestId('viewer-stack')).toBeInTheDocument()
    expect(screen.getByTestId('week-headline').className).toMatch(/text-hockia-primary/)
    expect(screen.getByTestId('week-tile-recruiters-value')).toHaveTextContent('4')
    expect(screen.getByTestId('week-tile-recruiters-sub')).toHaveTextContent('3 clubs · 1 coach')
    expect(screen.getByTestId('who-looked')).toBeInTheDocument()
    expect(screen.queryByText('Some Player')).not.toBeInTheDocument()
  })
})
