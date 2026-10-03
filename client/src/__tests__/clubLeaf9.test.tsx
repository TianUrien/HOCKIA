/**
 * Club v2 leaf 9 — Home (Figma D1.18 352:1290), Inbox (D1.19 353:502), Chat
 * (D1.20 353:718 / D1.21 353:809), Settings — club (D1.22 353:893) and the
 * Recruiting for sheet's "New context" form (D1.23 355:528). Pure helpers
 * first, then the rendered pieces.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import inboxSource from '@/pages/InboxPage.tsx?raw'
import {
  applicationCardDetail,
  applicationCardTitle,
  clubInboxRoleLine,
  clubWeekStats,
  inboxWaitingNotice,
  pickApplication,
  type ClubApplication,
} from '@/lib/clubInbox'
import { emptyContextDraft, newContextPayload, newContextProblem } from '@/lib/newContext'
import { clubLeagueSubtitle, contactEmailSubtitle, isValidContactEmail, CLUB_EDIT_PATH } from '@/lib/clubSettingsCopy'

// ── mocks for the rendered components ─────────────────────────────────────
const store = {
  create: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ id: 'ctx-new' })),
  update: vi.fn<(id: string, input: unknown) => Promise<void>>(async () => {}),
}
vi.mock('@/hooks/useRecruitingContext', () => ({
  useRecruitingContextStore: (sel: (s: typeof store) => unknown) => sel(store),
}))
const toasts: string[] = []
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: (m: string) => void }) => unknown) => sel({ addToast: (m: string) => { toasts.push(m) } }) }))

type P = { id: string; role: string; full_name: string; avatar_url: null; current_world_club_id: string | null; mens_league_division: string | null; womens_league_division: string | null; contact_email: string | null; contact_email_public: boolean }
let profile: P
const authState = () => ({
  user: { id: profile.id, email: 'club@hockia.test', app_metadata: { provider: 'email' } },
  profile,
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: ReturnType<typeof authState>) => unknown) => (sel ? sel(authState()) : authState()),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(async () => ({ data: [], error: null })) } }))
vi.mock('@/hooks/usePushSubscription', () => ({
  usePushSubscription: () => ({ isSupported: true, isSubscribed: true, permission: 'granted', loading: false, subscribe: vi.fn(), unsubscribe: vi.fn() }),
}))
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ blockedIds: new Set() }) }))
vi.mock('@/components/BlockedAccountsList', () => ({ default: () => null }))
vi.mock('@/components/DeleteAccountModal', () => ({ default: () => null }))
vi.mock('@/lib/analytics', () => ({ trackPushSubscribe: vi.fn(), trackPushUnsubscribe: vi.fn() }))
vi.mock('@/hooks/useFullMatchPrivacyNotice', () => ({ useFullMatchPrivacyNotice: () => ({ resolveNotice: vi.fn() }) }))

import { RankedForSheet } from '@/components/club/RankedForSheet'
import { ChatApplicationCard } from '@/components/club/ChatApplicationCard'
import SettingsMobile from '@/components/settings/SettingsMobile'

const asClub = (p: Partial<P> = {}) => {
  profile = { id: 'club-1', role: 'club', full_name: 'Kilkenny Hockey Club', avatar_url: null, current_world_club_id: 'w1', mens_league_division: 'Leinster Division 1A', womens_league_division: null, contact_email: null, contact_email_public: false, ...p }
}
const withClient = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  asClub()
  store.create.mockClear()
  store.update.mockClear()
  toasts.length = 0
})

// ── Home · Your week (DEV NOTE 355:910) ───────────────────────────────────
describe('club Your week', () => {
  it('shows to review · profile views · open roles; the role numbers open Opportunities', () => {
    const stats = clubWeekStats({ toReview: 3, views: 6, openRoles: 1 })
    expect(stats.map((s) => `${s.value} ${s.label}`)).toEqual(['3 to review', '6 profile views', '1 open role'])
    expect(stats.map((s) => s.to)).toEqual(['/opportunities', '/pulse', '/opportunities'])
    expect(stats[0].accent).toBe(true)
    expect(clubWeekStats({ toReview: 0, views: 1, openRoles: 2 }).map((s) => s.label)).toEqual(['to review', 'profile view', 'open roles'])
  })
})

// ── Inbox (DEV NOTE 355:914) ──────────────────────────────────────────────
describe('club Inbox', () => {
  it('role line is "Player · position", plus "Applied"', () => {
    expect(clubInboxRoleLine('player', 'Forward', true)).toBe('Player · Forward · Applied')
    expect(clubInboxRoleLine('player', 'Forward', false)).toBe('Player · Forward')
    expect(clubInboxRoleLine('coach', null, false)).toBe('Coach')
  })
  it('the amber notice counts conversations the club never wrote in, and hides at 0', () => {
    expect(inboxWaitingNotice([{ waiting: false, applied: true }])).toBeNull()
    const all = inboxWaitingNotice(Array.from({ length: 10 }, () => ({ waiting: true, applied: true })).concat([{ waiting: false, applied: true }]))
    expect(all).toEqual({ title: '10 people waiting for a first reply', sub: 'All of them applied to your roles.' })
    expect(inboxWaitingNotice([{ waiting: true, applied: true }, { waiting: true, applied: false }])?.sub).toBe('1 of them applied to your roles.')
    expect(inboxWaitingNotice([{ waiting: true, applied: false }])).toEqual({ title: '1 person waiting for a first reply', sub: null })
  })
  it('Requests keeps the red dot for clubs too (founder 2026-09-27) — no count', () => {
    expect(inboxSource).not.toMatch(/Requests · /)
  })
})

// ── Chat context card (DEV NOTES 355:919, 355:923) ────────────────────────
const app = (p: Partial<ClubApplication> = {}): ClubApplication => ({ id: 'a1', opportunityId: 'r1', status: 'pending', appliedAt: '2026-09-17T10:00:00Z', updatedAt: '2026-09-17T10:00:00Z', roleTitle: 'Men’s 1st player', rolePosition: 'midfielder', ...p })
describe('club Chat application card', () => {
  const now = new Date('2026-09-23T12:00:00Z')
  it('names the role it applied to', () => {
    expect(applicationCardTitle(app())).toBe('Applied to Midfielder · Men’s 1st player')
    expect(applicationCardTitle(app({ roleTitle: 'Midfielder' }))).toBe('Applied to Midfielder')
  })
  it('pending: days left to reply, amber at 5 or fewer', () => {
    expect(applicationCardDetail(app(), 14, now)).toEqual({ text: '17 Sep · 8 days left to reply', urgent: false })
    expect(applicationCardDetail(app({ appliedAt: '2026-09-10T10:00:00Z' }), 14, now)).toEqual({ text: '10 Sep · 1 day left to reply', urgent: true })
  })
  it('closed without a reply says when', () => {
    expect(applicationCardDetail(app({ status: 'no_response', appliedAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-18T10:00:00Z' }), 14, now)).toEqual({ text: '3 Sep · closed without a reply on 18 Sep', urgent: false })
    expect(applicationCardDetail(app({ status: 'shortlisted' }), 14, now).text).toBe('17 Sep · shortlisted')
  })
  it('picks the pending application first, else the most recent', () => {
    expect(pickApplication([app({ id: 'old', status: 'rejected', appliedAt: '2026-08-01' }), app({ id: 'p', appliedAt: '2026-09-01' })])?.id).toBe('p')
    expect(pickApplication([app({ id: 'a', status: 'rejected', appliedAt: '2026-08-01' }), app({ id: 'b', status: 'no_response', appliedAt: '2026-09-01' })])?.id).toBe('b')
    expect(pickApplication([])).toBeNull()
  })
  it('renders the card linking to the role’s Applicants', () => {
    render(<MemoryRouter><ChatApplicationCard app={app({ appliedAt: new Date().toISOString() })} expiryDays={14} /></MemoryRouter>)
    const card = screen.getByTestId('chat-application-card')
    expect(card.getAttribute('href')).toBe('/dashboard/opportunities/r1/applicants')
    expect(screen.getByText('Applied to Midfielder · Men’s 1st player')).toBeInTheDocument()
    expect(screen.getByText(/14 days left to reply/)).toBeInTheDocument()
  })
})

// ── New context (DEV NOTE 355:931) ────────────────────────────────────────
describe('New context', () => {
  it('needs a position and a team', () => {
    const d = emptyContextDraft()
    expect(newContextProblem(d, 'player')).toBe('Pick a position.')
    expect(newContextProblem({ ...d, position: 'midfielder' }, 'player')).toBe('Pick a team.')
    expect(newContextProblem({ ...d, position: 'midfielder', gender: 'Men' }, 'player')).toBeNull()
  })
  it('maps step-1 criteria onto a custom recruiting_context row', () => {
    const { create, update } = newContextPayload({ ...emptyContextDraft(), position: 'midfielder', positionRequired: true, gender: 'Men', label: '  Next season  ', level: 'elite', skills: ['drag_flicker'], skillsRequired: true, region: ' Dublin ' }, 'player')
    expect(create).toEqual({ type: 'custom', target_category: 'Men', region: 'Dublin', label: 'Next season' })
    expect(update).toEqual({ target_role: 'player', target_position: 'midfielder', target_level: 'elite', target_specialists: ['drag_flicker'], position_required: true, level_required: false, specialists_required: true })
  })
  it('a coach context never carries player must-haves or skills', () => {
    const { create, update } = newContextPayload({ ...emptyContextDraft(), position: 'head_coach', positionRequired: true, gender: 'Girls', skills: ['indoor'] }, 'coach')
    expect(create.target_category).toBe('Women')
    expect(update).toMatchObject({ target_role: 'coach', target_specialists: [], position_required: false, specialists_required: false })
  })
  it('the Recruiting for sheet opens the form and saving creates then fills the context', async () => {
    const onClose = vi.fn()
    render(<RankedForSheet open contexts={[]} activeId={null} roles={new Map()} onPick={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('new-context-button'))
    await screen.findByTestId('new-context-form')
    fireEvent.click(screen.getByTestId('new-context-save'))
    expect(screen.getByRole('alert').textContent).toBe('Pick a position.')
    fireEvent.click(screen.getByRole('radio', { name: 'Midfielder' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Women' }))
    fireEvent.click(screen.getByTestId('new-context-save'))
    await waitFor(() => expect(store.update).toHaveBeenCalled())
    expect(store.create).toHaveBeenCalledWith({ type: 'custom', target_category: 'Women', region: null, label: null })
    expect(store.update).toHaveBeenCalledWith('ctx-new', expect.objectContaining({ target_role: 'player', target_position: 'midfielder' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

// ── Settings — club (DEV NOTE 355:927) ────────────────────────────────────
describe('Settings — club', () => {
  it('copy helpers', () => {
    expect(clubLeagueSubtitle({ current_world_club_id: 'w', mens_league_division: 'Leinster Division 1A' })).toBe('Linked · Leinster Division 1A')
    expect(clubLeagueSubtitle({ current_world_club_id: null })).toBe('Not linked yet · link your club')
    expect(contactEmailSubtitle(null, false)).toBe('Private · players message you on Hockia')
    expect(contactEmailSubtitle('a@b.co', true)).toBe('Shown on your profile · a@b.co')
    expect(contactEmailSubtitle('a@b.co', false)).toBe('Private · a@b.co')
    expect(isValidContactEmail('')).toBe(true)
    expect(isValidContactEmail('nope')).toBe(false)
    expect(isValidContactEmail('a@b.co')).toBe(true)
    expect(CLUB_EDIT_PATH).toBe('/dashboard/club/edit')
  })
  it('the hub shows the club identity, the Club group and its footnote', () => {
    render(withClient(<SettingsMobile section="hub" />))
    expect(screen.getByText('Kilkenny Hockey Club')).toBeInTheDocument()
    expect(screen.getByText('Signed in with email')).toBeInTheDocument()
    expect(screen.getByText('Club · admin')).toBeInTheDocument()
    expect(screen.getByText('Linked · Leinster Division 1A')).toBeInTheDocument()
    expect(screen.getByText('Contact email')).toBeInTheDocument()
    expect(screen.getByText('Private · players message you on Hockia')).toBeInTheDocument()
    expect(screen.getByText('Your league and crest show on your roles and profile. Recruiting lives in Opportunities.')).toBeInTheDocument()
  })
  it('Contact email opens its sheet; a bad email is refused before saving', () => {
    render(withClient(<SettingsMobile section="hub" />))
    fireEvent.click(screen.getByText('Contact email'))
    const sheet = screen.getByTestId('contact-email-sheet')
    fireEvent.change(sheet.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Enter an email/)
  })
  it('Contact email sheet: shared switch copy and a Cancel that closes without saving', async () => {
    render(withClient(<SettingsMobile section="hub" />))
    fireEvent.click(screen.getByText('Contact email'))
    expect(screen.getByRole('switch', { name: 'Show on your profile' })).toBeInTheDocument()
    expect(screen.getByText('Off: players message you on Hockia.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('contact-email-sheet')).toBeNull())
  })
  it('Privacy no longer repeats the contact email switch for clubs', () => {
    render(withClient(<SettingsMobile section="privacy" />))
    expect(screen.queryByText('Show my contact email')).toBeNull()
  })
})
