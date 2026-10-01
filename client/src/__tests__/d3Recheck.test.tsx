/**
 * D3 re-check fixes:
 *  1. Invite sheet: the active "Ranked for" role was passed on → say so and
 *     make the club choose another role (no silent switch).
 *  2. Invite card in chat: "applied" is a grey status (club and player).
 *  3. Club-facing name search: players only when 18+ with a known date of birth.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inviteCardState, type InviteRole } from '@/lib/invites'
import { keepAdultPlayers } from '@/lib/findPlayers'

const role = (p: Partial<InviteRole> = {}): InviteRole => ({
  id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', compensation: 'paid',
  benefits: ['housing'], opportunity_type: 'player', ...p,
})

const inv = vi.hoisted(() => ({
  roles: [] as unknown[],
  declined: [] as string[],
  statusesLoading: false,
  send: vi.fn(),
  card: null as unknown,
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'club1' }, profile: { id: 'club1', role: 'club', full_name: 'E2E Test FC' } }
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/hooks/useInvites', () => ({
  INVITES_KEY: ['invites'],
  inviteCardKey: (id: string) => ['invites', 'card', id],
  useInviteRoles: () => ({ roles: inv.roles, loading: false }),
  useInviteAllowance: () => ({ limit: 20, sent: 0, reached: false }),
  useClubInviteStatuses: () => ({ pillFor: () => null, declinedFor: () => inv.declined, loading: inv.statusesLoading }),
  useSendInvite: () => ({ send: inv.send, sending: false }),
  useInviteCard: () => ({ data: inv.card, loading: false, refetch: vi.fn() }),
  useDeclineInvite: () => ({ decline: vi.fn(), busy: false }),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }) }))

import InviteSheet from '@/components/club/InviteSheet'
import InviteCard from '@/features/chat-v2/components/InviteCard'

const player = { id: 'p1', full_name: 'Ana Pérez', avatar_url: null, role: 'player', position: 'midfielder', secondary_position: null }

beforeEach(() => {
  inv.roles = [
    role(),
    role({ id: 'r2', title: 'QA TEST — Automated audit', position: 'forward', gender: 'Women' }),
    role({ id: 'r3', title: 'Reserve team', position: 'defender' }),
  ]
  inv.declined = []
  inv.statusesLoading = false
  inv.send.mockReset().mockResolvedValue(null)
  inv.card = {
    invite: { id: 'i1', status: 'applied', note: null, expires_at: '2099-01-01T00:00:00Z', club_id: 'club1', player_id: 'p1', application_id: 'a1' },
    role: { id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', status: 'open', start_date: null, duration_text: null, compensation: 'paid', benefits: [], opportunity_type: 'player', club_id: 'club1' },
    club: { full_name: 'E2E Test FC', avatar_url: null, role: 'club', mens_league_division: null, womens_league_division: null },
    playerName: 'E2E Player',
  }
})

describe('1 · invite sheet when the active role was passed on', () => {
  it('says so, preselects nothing, and keeps Send disabled until the club picks a role', async () => {
    inv.declined = ['r1']
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect(screen.getByTestId('invite-passed-active').textContent).toBe('Ana passed on Midfielder · Men’s 1st player — choose another role.')
    const rows = screen.getAllByTestId('invite-role')
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    // No note until a role is chosen (the draft follows the role).
    expect(screen.queryByRole('textbox')).toBeNull()
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('invite-change-role')).toBeNull()

    fireEvent.click(rows[2]) // Reserve team
    expect(screen.queryByTestId('invite-passed-active')).toBeNull()
    expect(screen.getAllByTestId('invite-role')).toHaveLength(1)
    expect(screen.getByTestId('invite-role').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('invite-role').textContent).toContain('Reserve team')
    const send = screen.getByTestId('invite-send') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(inv.send).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'r3' })))
  })

  it('statuses arriving after the sheet opened drop the preselection instead of switching roles', () => {
    const { rerender } = render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect(screen.getByTestId('invite-role').textContent).toContain('Men’s 1st player')
    inv.declined = ['r1']
    rerender(<InviteSheet open player={{ ...player }} activeRoleId="r1" onClose={vi.fn()} />)
    expect(screen.getByTestId('invite-passed-active')).toBeTruthy()
    expect(screen.getAllByTestId('invite-role').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Send waits for the passed-on roles to load', () => {
    inv.statusesLoading = true
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
  })

  it('active role not passed on → preselected as before, no message', () => {
    inv.declined = ['r2']
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect(screen.queryByTestId('invite-passed-active')).toBeNull()
    expect(screen.getByTestId('invite-role').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('invite-role').textContent).toContain('Men’s 1st player')
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(false)
  })

  it('no active role → the newest open role, as before', () => {
    render(<InviteSheet open player={player} activeRoleId={null} onClose={vi.fn()} />)
    expect(screen.queryByTestId('invite-passed-active')).toBeNull()
    expect(screen.getByTestId('invite-role').textContent).toContain('Men’s 1st player')
  })
})

describe('2 · "applied" on the invite card is grey', () => {
  const base = { expiresAt: '2099-01-01T00:00:00Z', roleOpen: true, playerFirstName: 'E2E', status: 'applied' as const }
  it('grey tone for the club and for the player', () => {
    expect(inviteCardState({ ...base, viewer: 'club' })).toMatchObject({ line: 'E2E applied', tone: 'grey' })
    expect(inviteCardState({ ...base, viewer: 'player' })).toMatchObject({ line: 'Applied', tone: 'grey' })
  })
  it('the club card renders a grey pill with no green tint or check', () => {
    render(<MemoryRouter><InviteCard inviteId="i1" opportunityId="r1" isMine fallbackText="x" /></MemoryRouter>)
    const pill = screen.getByTestId('invite-card-status')
    expect(pill.textContent).toBe('E2E applied')
    expect(pill.className).toContain('bg-surface-grouped')
    expect(pill.className).toContain('text-ink-2')
    expect(pill.className).not.toMatch(/positive/)
    expect(pill.querySelector('svg')).toBeNull()
  })
  it('the player card shows "Applied" in the same grey', () => {
    render(<MemoryRouter><InviteCard inviteId="i1" opportunityId="r1" isMine={false} fallbackText="x" /></MemoryRouter>)
    const pill = screen.getByTestId('invite-card-status')
    expect(pill.textContent).toBe('Applied')
    expect(pill.className).not.toMatch(/positive/)
  })
})

describe('3 · club-facing name search keeps players 18+ with a known date of birth', () => {
  const members = [
    { id: 'adult', role: 'player' },
    { id: 'no-dob', role: 'player' },
    { id: 'minor', role: 'player' },
    { id: 'coach', role: 'coach' },
    { id: 'club', role: 'club' },
  ]
  it('drops players with no date of birth or under 18; other roles are not age-checked', () => {
    const ages = [{ profile_id: 'adult', age: 24 }, { profile_id: 'minor', age: 16 }]
    expect(keepAdultPlayers(members, ages).map((m) => m.id)).toEqual(['adult', 'coach', 'club'])
  })
  it('18 exactly counts; a null age counts as unknown', () => {
    expect(keepAdultPlayers([{ id: 'a', role: 'player' }], [{ profile_id: 'a', age: 18 }])).toHaveLength(1)
    expect(keepAdultPlayers([{ id: 'a', role: 'player' }], [{ profile_id: 'a', age: null }])).toHaveLength(0)
  })
})
