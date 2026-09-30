/**
 * Club v2 leaf 7 — Squad — own (Figma 04 Club D1.15, DEV NOTE 338:702).
 * Pure helpers first, then the screen with its data hooks mocked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ageFrom,
  clubShortName,
  inviteStateFor,
  inviteErrorMessage,
  isInvitable,
  joinCountLine,
  squadRoleLine,
  squadSettingsSubtitle,
} from '@/lib/clubSquad'

const NOW = new Date('2026-09-27T12:00:00Z')

describe('row role line (DEV NOTE: always the role)', () => {
  const base = { position: null, secondary_position: null, coach_specialization: null, coach_specialization_custom: null }
  it('Player · positions', () => {
    expect(squadRoleLine({ ...base, role: 'player', position: 'midfielder', secondary_position: 'defender' })).toBe('Player · Midfielder · Defender')
    expect(squadRoleLine({ ...base, role: 'player', position: 'midfielder', secondary_position: 'midfielder' })).toBe('Player · Midfielder')
    expect(squadRoleLine({ ...base, role: 'player' })).toBe('Player')
  })
  it('Coach · specialty, custom text when the specialty is Other', () => {
    expect(squadRoleLine({ ...base, role: 'coach', coach_specialization: 'head_coach' })).toBe('Coach · Head coach')
    expect(squadRoleLine({ ...base, role: 'coach', coach_specialization: 'other', coach_specialization_custom: 'Video analyst' })).toBe('Coach · Video analyst')
    expect(squadRoleLine({ ...base, role: 'coach' })).toBe('Coach')
  })
})

describe('copy helpers', () => {
  it('short club name for the empty state', () => {
    expect(clubShortName('Kilkenny Hockey Club')).toBe('Kilkenny')
    expect(clubShortName('Old Georgians HC')).toBe('Old Georgians')
    expect(clubShortName('Club')).toBe('Club')
    expect(clubShortName(null)).toBe('your club')
  })
  it('join count shows only once someone joined', () => {
    expect(joinCountLine(0)).toBeNull()
    expect(joinCountLine(null)).toBeNull()
    expect(joinCountLine(3)).toBe('3 joined with this link')
  })
  it('Settings → Squad & invites subtitle', () => {
    expect(squadSettingsSubtitle(0)).toBe('No members yet · share your invite link')
    expect(squadSettingsSubtitle(1)).toBe('1 member · your invite link')
    expect(squadSettingsSubtitle(12)).toBe('12 members · your invite link')
  })
})

describe('invite search rules', () => {
  it('players: 18+ with a known date of birth; coaches are not age-gated (D2 rule, as on the server)', () => {
    expect(ageFrom('2008-09-28', NOW)).toBe(17)
    expect(ageFrom('2008-09-27', NOW)).toBe(18)
    expect(isInvitable('player', '2008-09-27', NOW)).toBe(true)
    expect(isInvitable('player', '2010-01-01', NOW)).toBe(false)
    expect(isInvitable('player', null, NOW)).toBe(false)
    expect(isInvitable('player', 'not a date', NOW)).toBe(false)
    expect(isInvitable('coach', null, NOW)).toBe(true)
  })
  it('maps the server refusal to a friendly message', () => {
    expect(inviteErrorMessage({ code: 'not_invitable', error: 'raw' })).toBe('This person can’t be invited yet.')
    expect(inviteErrorMessage({ error: 'Already a member' })).toBe('Already a member')
    expect(inviteErrorMessage({})).toBe('Could not send the invitation.')
  })
  it('a row is on the squad, pending, or invitable', () => {
    const members = new Set(['m'])
    const pending = new Set(['p'])
    expect(inviteStateFor('m', members, pending)).toBe('member')
    expect(inviteStateFor('p', members, pending)).toBe('pending')
    expect(inviteStateFor('x', members, pending)).toBe('invitable')
  })
})

// ── Screen ──────────────────────────────────────────────────────────

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const toast = vi.hoisted(() => ({ addToast: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: typeof toast) => unknown) => sel(toast) }))
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ blockedIds: new Set() }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('@/lib/profileShare', () => ({ getShareOrigin: () => 'https://inhockia.com' }))

const person = (id: string, extra: Record<string, unknown> = {}) => ({
  id, full_name: `Name ${id}`, avatar_url: null, role: 'player', position: 'defender', secondary_position: null,
  coach_specialization: null, coach_specialization_custom: null, ...extra,
})

type SquadState = {
  members: Array<ReturnType<typeof person> & { is_roster_member: boolean; is_test_account: boolean }>
  pending: Array<ReturnType<typeof person> & { club_member_id: string; invited_via: 'direct' | 'link'; created_at: string }>
  link: { id: string; token: string; join_count: number } | null
  loading: boolean
  error: string | null
}
const squad = vi.hoisted(() => ({
  state: {} as SquadState,
  ensureLink: vi.fn(),
  revokeLink: vi.fn(),
  invite: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
  search: { rows: [] as unknown[], searching: false, error: null as string | null, active: false },
}))
vi.mock('@/hooks/useClubSquad', () => ({
  useClubSquad: () => ({ ...squad.state, ensureLink: squad.ensureLink, revokeLink: squad.revokeLink, invite: squad.invite, remove: squad.remove, retry: squad.retry }),
  useInviteSearch: (_id: string, q: string) => ({ ...squad.search, active: q.trim().length >= 2 }),
}))

import SquadScreen from '@/components/club/SquadScreen'

const renderScreen = () => render(
  <MemoryRouter initialEntries={['/dashboard/profile/members']}>
    <SquadScreen profile={{ id: 'club-1', full_name: 'Kilkenny Hockey Club' }} onBack={vi.fn()} />
  </MemoryRouter>,
)

describe('SquadScreen (D1.15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    squad.state = { members: [], pending: [], link: null, loading: false, error: null }
    squad.search = { rows: [], searching: false, error: null, active: false }
  })

  it('empty state first: invite link, search, and the Figma line', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Squad' })).toBeTruthy()
    expect(screen.getByText('Players and staff who wear your crest on their profile.')).toBeTruthy()
    expect(screen.getByText('Anyone with it can ask to join. You approve each one.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Share link/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Invite someone on Hockia')).toBeTruthy()
    expect(screen.getByText('No one yet')).toBeTruthy()
    expect(screen.getByText(/Players who pick Kilkenny as their current club show up here on their own/)).toBeTruthy()
    // No link yet → no … menu, no join count.
    expect(screen.queryByRole('button', { name: 'Invite link options' })).toBeNull()
    expect(screen.queryByTestId('squad-join-count')).toBeNull()
  })

  it('Copy creates the link on first use and copies its URL', async () => {
    squad.ensureLink.mockResolvedValue({ token: 'tok123' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://inhockia.com/invite/club/tok123'))
    expect(toast.addToast).toHaveBeenCalledWith('Invite link copied', 'success')
  })

  it('join count once > 0, and Revoke lives in the … menu', async () => {
    squad.state.link = { id: 'l1', token: 't', join_count: 2 }
    squad.revokeLink.mockResolvedValue(true)
    renderScreen()
    expect(screen.getByTestId('squad-join-count').textContent).toBe('2 joined with this link')
    fireEvent.click(screen.getByRole('button', { name: 'Invite link options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke link' }))
    await waitFor(() => expect(squad.revokeLink).toHaveBeenCalled())
  })

  it('pending invitations are grey (never amber) and can be cancelled', async () => {
    squad.state.pending = [{ ...person('p1', { role: 'coach', coach_specialization: 'assistant_coach' }), club_member_id: 'cm1', invited_via: 'direct', created_at: '2026-09-20' }]
    squad.remove.mockResolvedValue({ success: true })
    renderScreen()
    expect(screen.queryByText('No one yet')).toBeNull()
    expect(screen.getByText('Coach · Assistant coach')).toBeTruthy()
    const status = screen.getByTestId('squad-pending-status')
    expect(status.textContent).toBe('Invitation pending')
    expect(status.className).toContain('text-ink-2')
    expect(status.className).not.toMatch(/amber/)
    fireEvent.click(screen.getByRole('button', { name: 'Options for Name p1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel invitation' }))
    await waitFor(() => expect(squad.remove).toHaveBeenCalledWith('p1'))
  })

  it('members show their role; only roster members can be removed; a row opens the profile', () => {
    squad.state.members = [
      { ...person('a'), is_roster_member: true, is_test_account: false },
      { ...person('b', { role: 'coach', coach_specialization: 'head_coach' }), is_roster_member: false, is_test_account: false },
    ]
    renderScreen()
    expect(screen.getByText('Members · 2')).toBeTruthy()
    expect(screen.getByText('Player · Defender')).toBeTruthy()
    expect(screen.getByText('Coach · Head coach')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Options for Name a' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Options for Name b' })).toBeNull()
    fireEvent.click(screen.getByText('Name b'))
    expect(navigateMock).toHaveBeenCalledWith('/coaches/id/b', expect.anything())
  })

  it('search results: Invite, pending, or already on the squad', async () => {
    squad.state.members = [{ ...person('m'), is_roster_member: true, is_test_account: false }]
    squad.state.pending = [{ ...person('p'), club_member_id: 'cm', invited_via: 'direct', created_at: '2026-09-20' }]
    squad.search.rows = [{ ...person('m'), current_club: null }, { ...person('p'), current_club: null }, { ...person('x'), current_club: null }]
    squad.invite.mockResolvedValue({ success: true })
    renderScreen()
    fireEvent.change(screen.getByPlaceholderText('Invite someone on Hockia'), { target: { value: 'Na' } })
    const rows = screen.getAllByTestId('squad-search-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('On your squad')
    expect(rows[1].textContent).toContain('Invitation pending')
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(squad.invite).toHaveBeenCalledWith('x'))
    expect(toast.addToast).toHaveBeenCalledWith('Invitation sent to Name x', 'success')
  })

  it('a server refusal (under 18 / no date of birth) shows the friendly message', async () => {
    squad.search.rows = [{ ...person('y'), current_club: null }]
    squad.invite.mockResolvedValue({ success: false, code: 'not_invitable', error: "This person can't be invited yet." })
    renderScreen()
    fireEvent.change(screen.getByPlaceholderText('Invite someone on Hockia'), { target: { value: 'Na' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(toast.addToast).toHaveBeenCalledWith('This person can’t be invited yet.', 'error'))
  })
})
