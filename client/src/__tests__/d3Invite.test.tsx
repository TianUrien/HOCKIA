/**
 * D3 · Invite to apply (Figma 400:4 — D3.1 Shortlist 393:2, D3.2 sheet
 * 393:178, D3.3 chat card 393:351, D3.4 Applicants 393:452; brief 402:83).
 * Pure rules first, then each surface with its data hooks mocked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  draftInviteNote,
  inviteCardState,
  inviteDailyLimit,
  inviteErrorMessage,
  inviteLimitReason,
  inviteRoleLabel,
  inviteSheetFooter,
  isInvitablePlayer,
  roleOfferLine,
  type InviteRole,
} from '@/lib/invites'

const NOW = new Date('2026-09-30T12:00:00Z')
const role = (p: Partial<InviteRole> = {}): InviteRole => ({
  id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', compensation: 'paid',
  benefits: ['job', 'housing', 'insurance', 'flights'], opportunity_type: 'player', ...p,
})

describe('who can be invited (DEV NOTE 394:102 + ruling 2026-09-27)', () => {
  it('only open-to-play players who are 18+ by a known date of birth', () => {
    expect(isInvitablePlayer({ role: 'player', open_to_play: true, age: 25 })).toBe(true)
    expect(isInvitablePlayer({ role: 'player', open_to_play: true, age: 18 })).toBe(true)
    expect(isInvitablePlayer({ role: 'player', open_to_play: true, age: 17 })).toBe(false)
    expect(isInvitablePlayer({ role: 'player', open_to_play: true, age: null })).toBe(false) // no date of birth
    expect(isInvitablePlayer({ role: 'player', open_to_play: false, age: 25 })).toBe(false)
    expect(isInvitablePlayer({ role: 'coach', open_to_play: true, age: 40 })).toBe(false)
  })
  it('20 a day, 5 a day in the club’s first week', () => {
    expect(inviteDailyLimit('2026-01-01T00:00:00Z', NOW)).toBe(20)
    expect(inviteDailyLimit('2026-09-27T00:00:00Z', NOW)).toBe(5)
    expect(inviteDailyLimit(null, NOW)).toBe(20)
    expect(inviteLimitReason(5)).toBe('You’ve sent 5 invites today, the daily limit. You can invite again tomorrow.')
  })
})

describe('the sheet copy (D3.2)', () => {
  it('drafts the note from the role fields and the club name only', () => {
    expect(draftInviteNote({ firstName: 'Facundo', clubName: 'Kilkenny Hockey Club', role: role() })).toBe(
      'Hi Facundo, we’re recruiting a midfielder for Kilkenny Hockey Club’s Men’s team, and your profile stood out. The role includes pay, housing, flights, insurance and a job. Would you like to apply?',
    )
    expect(draftInviteNote({ firstName: 'Ana', clubName: 'Club X', role: role({ position: 'forward', gender: 'Women', compensation: 'unpaid', benefits: [] }) })).toBe(
      'Hi Ana, we’re recruiting a forward for Club X’s Women’s team, and your profile stood out. Would you like to apply?',
    )
    expect(draftInviteNote({ firstName: 'Ana', clubName: 'Club X', role: role({ position: 'goalkeeper', gender: null, compensation: null, benefits: ['visa'] }) }))
      .toContain('we’re recruiting a goalkeeper for Club X, and')
  })
  it('role card: position · title, then the offer', () => {
    expect(inviteRoleLabel(role())).toBe('Midfielder · Men’s 1st player')
    expect(inviteRoleLabel(role({ position: null }))).toBe('Men’s 1st player')
    expect(roleOfferLine(role())).toBe('Paid · Housing · Flights · Insurance · Job')
    expect(roleOfferLine(role({ compensation: null, benefits: [] }))).toBeNull()
  })
  it('the footer is gender-neutral', () => {
    const footer = inviteSheetFooter('Facundo')
    expect(footer).toBe('Facundo sees the role and your note in Inbox. If they apply, they go straight to To review, marked Invited.')
    expect(footer).not.toMatch(/\b(he|his|him|she|her)\b/i)
  })
  it('maps the server’s refusals to what the club reads', () => {
    expect(inviteErrorMessage({ message: 'Daily invite limit reached (20 per day)' })).toBe(inviteLimitReason(20))
    expect(inviteErrorMessage({ message: 'This person can\'t be invited to this role' })).toBe('This player can’t be invited to this role.')
    expect(inviteErrorMessage({ message: 'This player already has an open invite from you' })).toBe('This player already has an open invite from you.')
    expect(inviteErrorMessage({ message: 'This player has already applied to one of your roles' })).toBe('This player has already applied to one of your roles.')
    expect(inviteErrorMessage({ message: 'This player passed on this role' })).toBe('This player passed on this role.')
    expect(inviteErrorMessage({ message: 'boom' })).toBe('Couldn’t send the invite. Please try again.')
  })
})

describe('the invite card state (D3.3)', () => {
  const base = { expiresAt: '2026-10-10T00:00:00Z', roleOpen: true, playerFirstName: 'Facundo', now: NOW }
  it('player: open invite → the three actions; club: grey "Invitation pending"', () => {
    expect(inviteCardState({ ...base, viewer: 'player', status: 'sent' })).toEqual({ muted: false, actionable: true, line: null, tone: 'grey' })
    expect(inviteCardState({ ...base, viewer: 'club', status: 'sent' })).toEqual({ muted: false, actionable: false, line: 'Invitation pending', tone: 'grey' })
  })
  it('applied / passed / expired / role closed', () => {
    expect(inviteCardState({ ...base, viewer: 'player', status: 'applied' }).line).toBe('Applied')
    expect(inviteCardState({ ...base, viewer: 'club', status: 'applied' }).line).toBe('Facundo applied')
    expect(inviteCardState({ ...base, viewer: 'club', status: 'declined' }).line).toBe('Facundo passed on this role')
    expect(inviteCardState({ ...base, viewer: 'player', status: 'declined' })).toMatchObject({ muted: true, line: 'You passed on this role' })
    expect(inviteCardState({ ...base, viewer: 'player', status: 'sent', expiresAt: '2026-09-29T00:00:00Z' })).toMatchObject({ muted: true, actionable: false, line: 'This invitation has expired' })
    expect(inviteCardState({ ...base, viewer: 'player', status: 'sent', roleOpen: false })).toMatchObject({ muted: true, actionable: false, line: 'This role is closed' })
  })
})

// ── Surfaces ─────────────────────────────────────────────────────────

const inv = vi.hoisted(() => ({
  roles: [] as unknown[],
  reached: false,
  declined: [] as string[],
  send: vi.fn(),
  decline: vi.fn(),
  card: null as unknown,
  applicants: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'club1' }, profile: { id: 'club1', role: 'club', full_name: 'Kilkenny Hockey Club' } }
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/hooks/useInvites', () => ({
  INVITES_KEY: ['invites'],
  inviteCardKey: (id: string) => ['invites', 'card', id],
  useInviteRoles: () => ({ roles: inv.roles, loading: false }),
  useInviteAllowance: () => ({ limit: 20, sent: inv.reached ? 20 : 3, reached: inv.reached }),
  useClubInviteStatuses: () => ({ pillFor: () => null, declinedFor: () => inv.declined, loading: false }),
  useSendInvite: () => ({ send: inv.send, sending: false }),
  useInviteCard: () => ({ data: inv.card, loading: false, refetch: vi.fn() }),
  useDeclineInvite: () => ({ decline: inv.decline, busy: false }),
}))
// useQuery: the sheet's organisation lookup (usePublisherOrganisation) — never enabled for a club account.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false }),
}))
// D5 entry row on the role (its own suite: d5Suggests.test.tsx).
vi.mock('@/hooks/useRoleSuggestions', () => ({ useRoleSuggestions: () => ({ data: null, suggestions: [], loading: false, error: false, refetch: () => undefined }) }))
vi.mock('@/hooks/useRoleApplicants', () => ({
  useRoleApplicants: () => ({
    loading: false, error: null, expiryDays: 14, refresh: vi.fn(), setLocalStatus: vi.fn(),
    role: { id: 'r1', club_id: 'club1', status: 'open', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', opportunity_type: 'player' },
    applicants: inv.applicants,
  }),
}))
vi.mock('@/components/club/RoleActions', () => ({ RoleActions: () => null }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }] }) }))

import { InviteAction } from '@/components/club/InviteAction'
import InviteSheet from '@/components/club/InviteSheet'
import InviteCard from '@/features/chat-v2/components/InviteCard'
import ApplicantsScreen from '@/components/club/ApplicantsScreen'

const inRouter = (el: React.ReactNode) => render(
  <MemoryRouter initialEntries={['/x']}>
    <Routes>
      <Route path="*" element={el} />
      <Route path="/opportunities/:id" element={<p>role page</p>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  inv.roles = [role(), role({ id: 'r2', title: 'Women’s 1st player', position: 'forward', gender: 'Women', benefits: [] })]
  inv.reached = false
  inv.declined = []
  inv.send.mockReset().mockResolvedValue(null)
  inv.decline.mockReset().mockResolvedValue(true)
  inv.applicants = []
  inv.card = {
    invite: { id: 'i1', status: 'sent', note: 'Hi Facundo, would you like to apply?', expires_at: '2099-01-01T00:00:00Z', club_id: 'club1', player_id: 'p1', application_id: null },
    role: { id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', status: 'open', start_date: '2026-09-01', duration_text: '7', compensation: 'paid', benefits: ['housing', 'flights', 'insurance', 'job'], opportunity_type: 'player', club_id: 'club1' },
    club: { full_name: 'Kilkenny Hockey Club', avatar_url: null, role: 'club', mens_league_division: 'Leinster Division 1A', womens_league_division: null },
    playerName: 'Facundo Diaz',
  }
})

describe('row action (D3.1, DEV NOTE 394:98)', () => {
  it('Invite for an invitable player; Applied / Invited pills otherwise; nothing when not invitable', () => {
    const onInvite = vi.fn()
    const { rerender } = render(<InviteAction pill={null} invitable onInvite={onInvite} />)
    const invite = screen.getByRole('button', { name: 'Invite to apply' })
    expect(invite.textContent).toBe('Invite')
    // Tonal, never Primary: the row action repeats, the screen keeps one Primary.
    expect(invite.className).toContain('bg-hockia-soft')
    expect(invite.className).toContain('text-hockia-primary')
    expect(invite.className).not.toContain('bg-hockia-primary')
    expect(invite.className).toContain('before:-inset-1') // 44 pt hit area on a 36 px button
    fireEvent.click(invite)
    expect(onInvite).toHaveBeenCalled()
    rerender(<InviteAction pill="applied" invitable onInvite={onInvite} />)
    expect(screen.getByTestId('invite-pill-applied').textContent).toBe('Applied')
    rerender(<InviteAction pill="invited" invitable onInvite={onInvite} />)
    expect(screen.getByTestId('invite-pill-invited').textContent).toBe('Invited')
    rerender(<InviteAction pill="passed" invitable onInvite={onInvite} />)
    expect(screen.getByTestId('invite-pill-passed').getAttribute('aria-label')).toBe('Passed on this role')
    expect(screen.queryByTestId('invite-button')).toBeNull()
    rerender(<InviteAction pill={null} invitable={false} onInvite={onInvite} />)
    expect(screen.queryByTestId('invite-button')).toBeNull()
  })
  it('daily limit reached → Invite disabled, with the reason', () => {
    render(<InviteAction pill={null} invitable limitReason={inviteLimitReason(20)} onInvite={vi.fn()} />)
    const b = screen.getByTestId('invite-button') as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-label')).toContain('daily limit')
  })
})

describe('Invite sheet (D3.2)', () => {
  const player = { id: 'p1', full_name: 'Facundo Diaz', avatar_url: null, role: 'player', position: 'midfielder', secondary_position: 'defender' }

  it('preselects the active role, drafts the note, and sends it', async () => {
    const onClose = vi.fn()
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={onClose} />)
    expect(screen.getByText('Invite Facundo to apply')).toBeTruthy()
    // One role card (the active one); Change role lists the others.
    expect(screen.getAllByTestId('invite-role')).toHaveLength(1)
    expect(screen.getByTestId('invite-role').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Midfielder · Men’s 1st player')).toBeTruthy()
    expect(screen.getByText('Paid · Housing · Flights · Insurance · Job')).toBeTruthy()
    const note = screen.getByRole('textbox', { name: 'Note to Facundo' }) as HTMLTextAreaElement
    expect(note.value).toMatch(/^Hi Facundo, we’re recruiting a midfielder for Kilkenny Hockey Club’s Men’s team/)
    expect(screen.getByTestId('invite-note-draft')).toBeTruthy()
    expect(screen.getByTestId('invite-footer').textContent).toBe(inviteSheetFooter('Facundo'))
    fireEvent.click(screen.getByTestId('invite-send'))
    await waitFor(() => expect(inv.send).toHaveBeenCalledWith({ playerId: 'p1', playerName: 'Facundo Diaz', opportunityId: 'r1', note: note.value }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('switching role re-drafts until the club edits; an edit is kept', () => {
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('invite-change-role'))
    expect(screen.getAllByTestId('invite-role')).toHaveLength(2)
    fireEvent.click(screen.getAllByTestId('invite-role')[1])
    expect(screen.getAllByTestId('invite-role')).toHaveLength(1)
    const note = screen.getByRole('textbox', { name: 'Note to Facundo' }) as HTMLTextAreaElement
    expect(note.value).toContain('a forward for Kilkenny Hockey Club’s Women’s team')
    fireEvent.change(note, { target: { value: 'My own words' } })
    expect(screen.queryByTestId('invite-note-draft')).toBeNull()
    fireEvent.click(screen.getByTestId('invite-change-role'))
    fireEvent.click(screen.getAllByTestId('invite-role')[0])
    expect((screen.getByRole('textbox', { name: 'Note to Facundo' }) as HTMLTextAreaElement).value).toBe('My own words')
  })

  it('the template label has no sparkle (sparkle is for real AI text only)', () => {
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    const label = screen.getByTestId('invite-note-draft')
    expect(label.textContent).toContain('Drafted from the role · tap to edit')
    expect(label.querySelector('.lucide-sparkles')).toBeNull()
    expect(label.querySelector('.lucide-pencil')).not.toBeNull()
  })

  it('a role the player passed on is never offered again; other roles stay invitable', async () => {
    inv.declined = ['r1']
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    // The active role was passed on → said so, nothing preselected, the club picks.
    expect(screen.getByTestId('invite-passed-active').textContent).toBe('Facundo passed on Midfielder · Men’s 1st player — choose another role.')
    expect(screen.getAllByTestId('invite-role')).toHaveLength(2)
    expect(screen.getAllByTestId('invite-role').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
    const passedRow = screen.getAllByTestId('invite-role').find((r) => r.getAttribute('data-passed'))!
    expect(passedRow.textContent).toContain('Passed on this role')
    fireEvent.click(passedRow)
    expect(screen.getAllByTestId('invite-role')).toHaveLength(2) // the passed role can't be chosen
    fireEvent.click(screen.getAllByTestId('invite-role').find((r) => !r.getAttribute('data-passed'))!)
    fireEvent.click(screen.getByTestId('invite-send'))
    await waitFor(() => expect(inv.send).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'r2' })))
  })

  it('passed on every open role → nothing to send', () => {
    inv.declined = ['r1', 'r2']
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect(screen.getAllByTestId('invite-role').every((r) => r.textContent?.includes('Passed on this role'))).toBe(true)
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the server’s reason and stays open when the invite is refused', async () => {
    inv.send.mockResolvedValue('This player already has an open invite from you.')
    const onClose = vi.fn()
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('invite-send'))
    expect((await screen.findByTestId('invite-error')).textContent).toBe('This player already has an open invite from you.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('daily limit reached → Send disabled with the reason', () => {
    inv.reached = true
    render(<InviteSheet open player={player} activeRoleId="r1" onClose={vi.fn()} />)
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('invite-error').textContent).toBe(inviteLimitReason(20))
  })

  it('no open roles → says so; nothing to send', () => {
    inv.roles = []
    render(<InviteSheet open player={player} activeRoleId={null} onClose={vi.fn()} />)
    expect(screen.getByTestId('invite-no-roles')).toBeTruthy()
    expect((screen.getByTestId('invite-send') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Invitation in chat (D3.3)', () => {
  it('player: role facts, the note, View role / Apply / Not interested — no fit, no counts', () => {
    inRouter(<InviteCard inviteId="i1" opportunityId="r1" isMine={false} fallbackText="x" />)
    expect(screen.getByText('Invitation to apply')).toBeTruthy()
    expect(screen.getByText('Midfielder · Men’s 1st player')).toBeTruthy()
    expect(screen.getByText('Housing · Flights · Insurance · Job')).toBeTruthy()
    expect(screen.getByText('Leinster Division 1A')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
    expect(screen.getByTestId('invite-card-note').textContent).toBe('Hi Facundo, would you like to apply?')
    expect(screen.getByTestId('invite-apply')).toBeTruthy()
    expect(screen.queryByText(/fit|applied since|applicants/i)).toBeNull()
    fireEvent.click(screen.getByTestId('invite-view-role'))
    expect(screen.getByText('role page')).toBeTruthy()
  })

  it('Not interested asks once, then declines', async () => {
    inRouter(<InviteCard inviteId="i1" opportunityId="r1" isMine={false} fallbackText="x" />)
    fireEvent.click(screen.getByTestId('invite-not-interested'))
    fireEvent.click(within(await screen.findByTestId('invite-pass-confirm')).getByRole('button', { name: 'Not interested' }))
    await waitFor(() => expect(inv.decline).toHaveBeenCalledWith('i1'))
  })

  it('club (sender) sees a grey "Invitation pending" and no actions', () => {
    inRouter(<InviteCard inviteId="i1" opportunityId="r1" isMine fallbackText="x" />)
    expect(screen.getByTestId('invite-card-status').textContent).toBe('Invitation pending')
    expect(screen.getByTestId('invite-card-status').className).toContain('text-ink-2')
    expect(screen.queryByTestId('invite-apply')).toBeNull()
  })

  it('role closed → the card greys out for the player', () => {
    ;(inv.card as { role: { status: string } }).role.status = 'closed'
    inRouter(<InviteCard inviteId="i1" opportunityId="r1" isMine={false} fallbackText="x" />)
    expect(screen.getByTestId('invite-card').className).toContain('border-line')
    expect(screen.getByTestId('invite-card-status').textContent).toBe('This role is closed')
    expect(screen.queryByTestId('invite-apply')).toBeNull()
  })

  it('unreadable invite → the plain message text', () => {
    inv.card = null
    inRouter(<InviteCard inviteId="i1" opportunityId="r1" isMine={false} fallbackText="Kilkenny invited you to apply for Men’s 1st player." />)
    expect(screen.getByText('Kilkenny invited you to apply for Men’s 1st player.')).toBeTruthy()
  })
})

describe('Applicants with an invited player (D3.4)', () => {
  const person = (id: string, fullName: string) => ({
    id, fullName, avatarUrl: null, role: 'player', position: 'midfielder', secondaryPosition: 'defender', nationalityCountryId: 1,
    nationality2CountryId: null, baseLocation: null, playingCategory: 'adult_men', lastActiveAt: null, currentClub: null, currentWorldClubId: null,
  })
  it('an application from an invite shows the Invited tag; others keep New', () => {
    inv.applicants = [
      { applicationId: 'a1', status: 'pending', appliedAt: '2026-09-20T00:00:00Z', updatedAt: null, metadata: {}, viewed: false, invited: false, fit: null, person: person('p2', 'Guido Piergiacomi') },
      { applicationId: 'a2', status: 'pending', appliedAt: '2026-09-29T00:00:00Z', updatedAt: null, metadata: {}, viewed: false, invited: true, fit: null, person: person('p1', 'Facundo Diaz') },
    ]
    inRouter(<ApplicantsScreen roleId="r1" />)
    const rows = screen.getAllByTestId('applicant-row')
    expect(rows).toHaveLength(2)
    expect(rows[1].textContent).toContain('Facundo Diaz')
    expect(screen.getAllByTestId('applicant-invited-tag')).toHaveLength(1)
    expect(rows[1].querySelector('[data-testid="applicant-invited-tag"]')?.textContent).toBe('Invited')
    expect(rows[0].textContent).toContain('New')
  })
})
