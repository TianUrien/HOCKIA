/**
 * Player alignment round 2a — Inbox + Chat (Figma 100:278 / 100:406 /
 * 115:1247 / 100:531 / 100:636), My applications (101:353 / 115:1382), the
 * Apply sheet (43:274 / 285:629), Application sent (115:865) and the coach
 * role detail header.
 *
 * Runs without env vars: the Supabase client is mocked.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vacancy } from '@/lib/supabase'

const AMBER = /amber|yellow|#b45309|#fdf1e4|status-warning/i

// ── Mocks ────────────────────────────────────────────────────────────────
let conversations: Record<string, unknown>[] = []
let fullMatchCount = 0
vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const result = () => Promise.resolve({ data: null, count: fullMatchCount, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'insert']) chain[m] = () => chain
    chain.maybeSingle = result
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  return { supabase: { from: () => builder(), rpc: async () => ({ data: conversations, error: null }) } }
})

let authState: { user: { id: string } | null; profile: Record<string, unknown> | null } = { user: { id: 'me' }, profile: { id: 'me', role: 'player' } }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(authState) : authState),
}))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }),
  isEuCountryCode: () => false,
}))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => undefined }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackApplicationSubmit: vi.fn() }))
vi.mock('@/components', () => ({ Header: () => null, NewMessageModal: () => null }))
vi.mock('@/components/safety/MoreMenu', () => ({ MoreMenu: () => null }))
vi.mock('@/components/safety/useReportAction', () => ({ useReportAction: () => ({ item: { key: 'report', label: 'Report', onSelect: () => {} }, sheet: null }) }))

let mutual: Record<string, number> = {}
vi.mock('@/hooks/useFriendsInCommon', () => ({
  useFriendsInCommon: (id: string | null) => ({ people: [], count: id ? mutual[id] ?? 0 : 0, loading: false }),
}))

let eligibility: { eligible: boolean; reason?: string } = { eligible: true }
vi.mock('@/lib/opportunityEligibility', () => ({ checkOpportunityEligibility: () => eligibility }))

let dots = { messages: false, requests: true, activity: false }
vi.mock('@/hooks/useInboxSegmentDots', () => ({ useInboxSegmentDots: () => dots }))
vi.mock('@/hooks/useFriendRequests', () => ({
  useFriendRequests: () => ({ incoming: [], outgoing: [], loading: false, pendingId: null, respond: async () => true, refresh: async () => {} }),
}))
vi.mock('@/hooks/useClubInvitations', () => ({ useMyClubInvitations: () => ({ invitations: [] }) }))
vi.mock('@/hooks/useRespondToClubInvite', () => ({ useRespondToClubInvite: () => ({ pendingId: null, respond: async () => true }) }))
vi.mock('@/hooks/friendshipEdgeCache', () => ({ loadFriendshipEdges: async () => {} }))
vi.mock('@/hooks/useScrollRestore', () => ({ useScrollRestore: () => undefined }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => undefined }))
vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (sel: (s: unknown) => unknown) =>
    sel({ notifications: [], loading: false, unreadCount: 0, markRead: vi.fn(), markAllRead: vi.fn(), respondToFriendRequest: vi.fn(), pendingFriendshipId: null }),
}))

import type { MyApplicationRow } from '@/hooks/useMyApplicationsAll'
let applications: MyApplicationRow[] = []
vi.mock('@/hooks/useMyApplicationsAll', () => ({ useMyApplicationsAll: () => ({ rows: applications, loading: false }) }))

import InboxPage from '@/pages/InboxPage'
import MyApplicationsPage from '@/pages/MyApplicationsPage'
import { InboxMessages } from '@/components/inbox/InboxMessages'
import { InboxRequests } from '@/components/inbox/InboxRequests'
import { ActivityIconCircle, ActivityRow } from '@/components/ui/ActivityRow'
import { MessageBubble } from '@/features/chat-v2/components/MessageBubble'
import ApplyToVacancyModal from '@/components/ApplyToOpportunityModal'
import { ApplicationSent, FULL_MATCH_TIP } from '@/components/opportunities/ApplicationSent'
import { OpportunityDetailMobile } from '@/components/opportunities/OpportunityDetailMobile'
import { applicationStatusPill, APPLICATION_TONE_TEXT } from '@/lib/opportunityCopy'
import type { FriendRequest } from '@/hooks/useFriendRequests'
import type { ChatMessage } from '@/types/chat'

const withQuery = (ui: React.ReactNode, path = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  conversations = []
  fullMatchCount = 0
  mutual = {}
  eligibility = { eligible: true }
  dots = { messages: false, requests: true, activity: false }
  applications = []
  authState = { user: { id: 'me' }, profile: { id: 'me', role: 'player' } }
})

// ── A. Inbox ─────────────────────────────────────────────────────────────
describe('Inbox header + segments', () => {
  it('large title, one edit action, and a DOT (never a number) on Requests', () => {
    render(withQuery(<InboxPage />, '/inbox/requests'))
    expect(screen.getAllByRole('heading', { name: 'Inbox' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'New message' }).length).toBeGreaterThan(0)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Messages', 'Requests', 'Activity'])
    const requests = tabs[1]
    expect(within(requests).getByTestId('segment-dot-requests')).toBeInTheDocument()
    expect(requests.textContent).not.toMatch(/\d/)
    expect(screen.queryByTestId('segment-dot-messages')).toBeNull()
    expect(screen.queryByTestId('segment-dot-activity')).toBeNull()
  })
  it('no dot when nothing is pending', () => {
    dots = { messages: false, requests: false, activity: false }
    render(withQuery(<InboxPage />, '/inbox/requests'))
    expect(screen.queryByTestId('segment-dot-requests')).toBeNull()
  })
})

describe('Inbox › Messages rows', () => {
  const row = (p: Record<string, unknown>) => ({
    conversation_id: 'c1', other_participant_id: 'club-1', other_participant_name: 'Hockey Team Bologna', other_participant_username: null,
    other_participant_avatar: null, other_participant_role: 'club', last_message_content: 'Thanks — can you send your full match?',
    last_message_sent_at: new Date().toISOString(), last_message_sender_id: 'club-1', unread_count: 0,
    conversation_created_at: new Date().toISOString(), conversation_updated_at: new Date().toISOString(), conversation_last_message_at: new Date().toISOString(), ...p,
  })

  it('a filled grey Search field and a row with name, date, meta and preview', async () => {
    conversations = [row({})]
    render(withQuery(<InboxMessages onCompose={() => {}} />))
    const search = screen.getByTestId('inbox-search')
    expect(search.className).toContain('bg-surface-muted')
    expect(search.className).not.toMatch(/border-/)
    const item = await screen.findByTestId('conversation-row')
    expect(within(item).getByText('Hockey Team Bologna')).toBeInTheDocument()
    expect(within(item).getByText('Club')).toBeInTheDocument()
    expect(within(item).getByText('Thanks — can you send your full match?')).toBeInTheDocument()
    // Today → the app's one clock ("10:04 AM").
    expect(within(item).getByTestId('conversation-date').textContent).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
    expect(screen.queryByTestId('inbox-unread-dot')).toBeNull()
  })

  it('unread = a brand-purple dot, no number, never amber for the player', async () => {
    conversations = [row({ unread_count: 7 })]
    render(withQuery(<InboxMessages onCompose={() => {}} />))
    const dot = await screen.findByTestId('inbox-unread-dot')
    expect(dot.className).toContain('bg-hockia-primary')
    expect(dot.className).not.toMatch(AMBER)
    expect(dot.textContent).toBe('')
    expect(screen.getByTestId('conversation-row').textContent).not.toContain('7')
    expect(screen.queryByTestId('inbox-waiting-dot')).toBeNull()
    expect(screen.queryByTestId('club-inbox-waiting-notice')).toBeNull()
  })

  it('older threads show a day-first date', async () => {
    conversations = [row({ conversation_last_message_at: '2025-09-12T10:00:00Z' })]
    render(withQuery(<InboxMessages onCompose={() => {}} />))
    const item = await screen.findByTestId('conversation-row')
    expect(within(item).getByTestId('conversation-date').textContent).toBe('12 Sep 2025')
  })
})

describe('Inbox › Requests rows (List item / Request)', () => {
  const person = (id: string, name: string, role = 'player', position: string | null = 'goalkeeper') => ({
    id, full_name: name, username: null, avatar_url: null, role, position, current_club: null,
  })
  const req = (id: string, p: ReturnType<typeof person>): FriendRequest => ({ friendshipId: id, person: p, createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString() })
  const renderRequests = (props: Partial<React.ComponentProps<typeof InboxRequests>> = {}) =>
    render(
      <MemoryRouter>
        <InboxRequests incoming={[]} outgoing={[]} loading={false} pendingId={null} respond={async () => true} {...props} />
      </MemoryRouter>,
    )

  it('keeps the explainer line and the Sent header', () => {
    renderRequests({ outgoing: [req('f9', person('p9', 'North East H.C.', 'club', null))] })
    expect(screen.getByTestId('requests-explainer')).toHaveTextContent('Friends can message you, see your full media and write you a reference.')
    expect(screen.getByRole('heading', { name: 'Sent' })).toBeInTheDocument()
  })

  it('Incoming: "role · position", mutual friends, Primary Small Accept + Muted ✕', () => {
    mutual = { p1: 2, p2: 1, p3: 0 }
    renderRequests({ incoming: [req('f1', person('p1', 'Marcia LaPlante')), req('f2', person('p2', 'Reagan Mmella', 'player', 'midfielder')), req('f3', person('p3', 'Mike'))] })
    const rows = screen.getAllByTestId('request-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute('data-state', 'incoming')
    expect(within(rows[0]).getByText('Player · Goalkeeper')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('request-detail')).toHaveTextContent('2 mutual friends')
    expect(within(rows[1]).getByTestId('request-detail')).toHaveTextContent('1 mutual friend')
    expect(within(rows[2]).getByTestId('request-detail')).toHaveTextContent('No mutual friends yet')
    const accept = within(rows[0]).getByRole('button', { name: 'Accept' })
    expect(accept.className).toContain('bg-hockia-soft')
    expect(accept.className).toContain('h-9')
    const decline = within(rows[0]).getByRole('button', { name: 'Decline Marcia LaPlante' })
    expect(decline).toHaveAttribute('data-variant', 'muted')
  })

  it('Accepted: the row itself confirms — green "Friends" and the next step, no buttons', async () => {
    const respond = vi.fn(async () => true)
    const request = req('f1', person('p1', 'Lazio Hockey', 'club', null))
    const view = renderRequests({ incoming: [request], respond })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith('f1', 'accept'))
    // The live list no longer carries the request; the row stays as the confirmation.
    view.rerender(
      <MemoryRouter>
        <InboxRequests incoming={[]} outgoing={[]} loading={false} pendingId={null} respond={respond} />
      </MemoryRouter>,
    )
    const row = await screen.findByTestId('request-row')
    expect(row).toHaveAttribute('data-state', 'accepted')
    const friends = within(row).getByTestId('request-friends')
    expect(friends).toHaveTextContent('Friends')
    expect(friends.className).toContain('text-positive')
    expect(within(row).getByTestId('request-detail')).toHaveTextContent('You can now message and reference each other')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Sent: grey "Waiting", no action', () => {
    renderRequests({ outgoing: [req('f9', person('p9', 'North East H.C.', 'club', null))] })
    const row = screen.getByTestId('request-row')
    expect(row).toHaveAttribute('data-state', 'sent')
    const waiting = within(row).getByTestId('request-waiting')
    expect(waiting).toHaveTextContent('Waiting')
    expect(waiting.className).toContain('text-ink-3')
    expect(waiting.className).not.toMatch(AMBER)
    expect(within(row).getByText(/Club · sent 4d/)).toBeInTheDocument()
    expect(within(row).queryByRole('button')).toBeNull()
  })
})

describe('List item / Activity (ui/ActivityRow)', () => {
  it('a row with a destination is tappable and shows the chevron', () => {
    const onOpen = vi.fn()
    render(<ActivityRow leading={<ActivityIconCircle icon={Bell} />} text="CASI posted a new role." when="6d" onOpen={onOpen} />)
    const row = screen.getByTestId('activity-row-link')
    expect(screen.getByTestId('activity-row-chevron')).toBeInTheDocument()
    expect(screen.getByTestId('activity-row-chevron').getAttribute('class')).toContain('text-ink-4')
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
  it('a row without a destination is plain: no chevron, not a button', () => {
    render(<ActivityRow leading={<ActivityIconCircle icon={Bell} />} text="Lazio Hockey accepted your friend request." when="5h" />)
    expect(screen.getByTestId('activity-row-plain')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-row-chevron')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('sentence 16/22 ink-1, time in ink-3 under it, 16 px side padding, brand-soft icon circle, purple unread dot', () => {
    render(<ActivityRow leading={<ActivityIconCircle icon={Bell} />} text="North East H.C. viewed your profile." when="3d" unread />)
    const text = screen.getByTestId('activity-row-text')
    expect(text.className).toContain('text-[16px]')
    expect(text.className).toContain('leading-[22px]')
    expect(text.className).toContain('text-ink-1')
    expect(screen.getByTestId('activity-row-when').className).toContain('text-ink-3')
    expect(screen.getByTestId('activity-row-plain').className).toContain('pl-4')
    expect(screen.getByTestId('activity-row-icon').className).toContain('bg-hockia-soft')
    expect(screen.getByTestId('activity-row-unread').className).toContain('bg-hockia-primary')
    expect(document.body.innerHTML).not.toMatch(AMBER)
  })
})

describe('Chat bubbles', () => {
  const message = (p: Partial<ChatMessage> = {}) => ({
    id: 'm1', conversation_id: 'c1', sender_id: 'me', content: 'Thank you!', sent_at: new Date().toISOString(),
    read_at: null, edited_at: null, deleted_at: null, metadata: null, ...p,
  }) as unknown as ChatMessage
  const bubble = (isMine: boolean) =>
    render(
      <MemoryRouter>
        <MessageBubble message={message()} isMine={isMine} status="delivered" isGroupedWithPrevious={false} showDayDivider={false} showTimestamp={false} isUnreadMarker={false}
          onRetry={() => {}} onDeleteFailed={() => {}} onEditSave={async () => true} onDelete={async () => true} />
      </MemoryRouter>,
    )
  it('outgoing: solid brand, radius 16, no gradient', () => {
    bubble(true)
    const el = screen.getByTestId('message-bubble')
    expect(el.className).toContain('bg-hockia-primary')
    expect(el.className).toContain('rounded-card')
    expect(el.className).not.toMatch(/gradient/)
  })
  it('incoming: grey', () => {
    bubble(false)
    const el = screen.getByTestId('message-bubble')
    expect(el.className).toContain('bg-surface-grouped')
    expect(el.className).not.toMatch(/gradient|bg-hockia-primary/)
  })
})

// ── B. My applications ───────────────────────────────────────────────────
describe('My applications rows (List item / Application)', () => {
  const app = (p: Partial<MyApplicationRow>): MyApplicationRow => ({
    id: 'a1', opportunityId: 'o1', status: 'pending', appliedAt: '2026-03-04T10:00:00Z', title: 'Forward', position: 'forward', gender: 'Women',
    opportunityType: 'player', roleOpen: true, country: 'Italy', club: { id: 'club-1', name: 'Hockey Team Bologna', avatarUrl: null, role: 'club' },
    active: true, hasClubNote: false, ...p,
  })

  it('tones follow the status helpers: only Shortlisted / offer / signed are positive', () => {
    const tone = (s: string, open = true, at: string | null = null) => applicationStatusPill(s, at, open).tone
    for (const s of ['shortlisted', 'offered', 'accepted', 'signed']) expect(tone(s)).toBe('positive')
    for (const s of ['maybe', 'rejected', 'no_response', 'filled', 'withdrawn']) expect(tone(s)).toBe('grey')
    expect(applicationStatusPill('maybe', null, true).label).toBe('Replied')
    expect(applicationStatusPill('rejected', null, true).label).toBe('Not selected')
    expect(applicationStatusPill('pending', null, false)).toEqual({ label: 'Role closed', tone: 'grey' })
    const old = new Date(Date.now() - 16 * 86_400_000).toISOString()
    expect(applicationStatusPill('pending', old, true)).toMatchObject({ label: 'No reply · 16d', tone: 'grey' })
    for (const cls of Object.values(APPLICATION_TONE_TEXT)) expect(cls).not.toMatch(AMBER)
  })

  it('Active · N | Closed · N, rows with title, "Club · Country", status words and a day-first applied date', () => {
    applications = [
      app({ id: 'a1', status: 'maybe' }),
      app({ id: 'a2', status: 'shortlisted', club: { id: 'club-2', name: 'North East H.C.', avatarUrl: null, role: 'club' }, country: 'Australia' }),
      app({ id: 'a3', status: 'rejected', active: false }),
    ]
    render(withQuery(<MyApplicationsPage />, '/opportunities/applications'))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Active · 2', 'Closed · 1'])
    const rows = screen.getAllByTestId('application-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('application-role-title')).toHaveTextContent('Forward')
    expect(within(rows[0]).getByText('Hockey Team Bologna · Italy')).toBeInTheDocument()
    const replied = within(rows[0]).getByTestId('application-status')
    expect(replied).toHaveTextContent('Replied')
    expect(replied.className).toContain('text-ink-2')
    expect(replied.className).not.toMatch(/positive|bg-/)
    expect(within(rows[0]).getByTestId('application-applied')).toHaveTextContent('Applied 4 Mar')
    expect(within(rows[0]).getByTestId('application-row-chevron')).toBeInTheDocument()
    const shortlisted = within(rows[1]).getByTestId('application-status')
    expect(shortlisted).toHaveTextContent('Shortlisted')
    expect(shortlisted.className).toContain('text-positive')
    expect(document.body.innerHTML).not.toMatch(AMBER)
  })

  it('Closed: "Not selected" (never "Declined") and "Role closed", both grey', () => {
    applications = [app({ id: 'a3', status: 'rejected', active: false }), app({ id: 'a4', status: 'pending', roleOpen: false, active: false })]
    render(withQuery(<MyApplicationsPage />, '/opportunities/applications?segment=closed'))
    const statuses = screen.getAllByTestId('application-status')
    expect(statuses.map((s) => s.textContent)).toEqual(['Not selected', 'Role closed'])
    for (const s of statuses) expect(s.className).toContain('text-ink-2')
    expect(document.body.textContent).not.toMatch(/Declined/)
  })

  it('the help card’s "Message <club>" is a Link button', () => {
    applications = [app({ id: 'a5', status: 'pending', appliedAt: new Date(Date.now() - 16 * 86_400_000).toISOString(), club: { id: 'club-3', name: 'CASI', avatarUrl: null, role: 'club' } })]
    render(withQuery(<MyApplicationsPage />, '/opportunities/applications'))
    expect(screen.getByTestId('application-status')).toHaveTextContent('No reply · 16d')
    expect(screen.getByTestId('application-status').className).toContain('text-ink-2')
    const link = screen.getByTestId('no-reply-message-link')
    expect(link).toHaveTextContent('Message CASI')
    expect(link.className).toContain('text-hockia-primary')
    expect(link.className).toContain('bg-transparent')
    expect(link.querySelector('svg')).toBeNull()
  })
})

// ── B. Apply sheet + Application sent ────────────────────────────────────
const vacancy = {
  id: 'opp-1', club_id: 'club-1', title: 'Forward', opportunity_type: 'player', position: 'forward', gender: 'Women', status: 'open',
  location_city: 'Bologna', location_country: 'Italy', created_at: '2026-09-01T00:00:00Z', application_deadline: null, start_date: null,
  duration_text: null, benefits: [], custom_benefits: [], specialist_skills_wanted: [], requirements: [], description: null, compensation: null,
  eu_passport_required: false, organization_name: 'Hockey Team Bologna',
} as unknown as Vacancy

describe('Apply sheet', () => {
  const sheet = () =>
    render(
      <MemoryRouter>
        <ApplyToVacancyModal isOpen onClose={() => {}} vacancy={vacancy} onSuccess={() => {}} clubName="Hockey Team Bologna" clubLogo={null} publisherRole="club" league="Serie A1" />
      </MemoryRouter>,
    )

  it('eligible: header, three Detail rows with a chevron, the message box and the one Primary', () => {
    sheet()
    expect(screen.getByRole('heading', { name: 'Apply to Hockey Team Bologna' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-variant', 'ghost')
    const rows = screen.getAllByTestId('apply-detail-row')
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(['Available from', 'Passport', 'Contact'])
    for (const r of rows) expect(r.querySelector('svg')).not.toBeNull()
    expect(screen.getByPlaceholderText('Add a message to the club (optional)')).toBeInTheDocument()
    const send = screen.getByTestId('send-application')
    expect(send).toHaveTextContent('Send application')
    expect(send).not.toBeDisabled()
    expect(send.className).toContain('bg-hockia-primary')
    expect(screen.queryByRole('button', { name: 'Message the club' })).toBeNull()
    expect(screen.queryByTestId('apply-not-eligible')).toBeNull()
    expect(screen.getByText('Your profile, career and highlights are sent automatically. Withdraw any time from My applications.')).toBeInTheDocument()
  })

  it('not eligible: a NEUTRAL callout with an info icon (never amber), Secondary "Message the club", Primary disabled', () => {
    eligibility = { eligible: false, reason: 'This role requires an EU passport.' }
    sheet()
    const callout = screen.getByTestId('apply-not-eligible')
    expect(callout.className).toContain('bg-surface-muted')
    expect(callout.className).toContain('text-ink-2')
    expect(callout.outerHTML).not.toMatch(AMBER)
    expect(callout.querySelector('svg')).not.toBeNull()
    expect(callout).toHaveTextContent('asks for an EU passport')
    expect(screen.queryByPlaceholderText('Add a message to the club (optional)')).toBeNull()
    const message = screen.getByRole('button', { name: 'Message the club' })
    expect(message.className).toContain('ring-line')
    expect(message.className).not.toContain('bg-hockia-primary')
    expect(screen.getByTestId('send-application')).toBeDisabled()
    expect(screen.getByText(/^Nothing was sent\. Passports are edited from Edit profile/)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toMatch(AMBER)
  })
})

describe('Application sent', () => {
  const sent = () =>
    render(
      <MemoryRouter>
        <ApplicationSent clubName="Hockey Team Bologna" clubLogo={null} publisherRole="club" onClose={() => {}} />
      </MemoryRouter>,
    )

  it('Ghost ✕, Primary "View my applications" and Secondary "Back to roles"', () => {
    sent()
    expect(screen.getByRole('heading', { name: 'Application sent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-variant', 'ghost')
    expect(screen.getByRole('button', { name: 'View my applications' }).className).toContain('bg-hockia-primary')
    const back = screen.getByRole('button', { name: 'Back to roles' })
    expect(back.className).toContain('ring-line')
    expect(back.className).not.toContain('bg-hockia-primary')
  })

  it('the tip reads exactly as approved and says nothing about other applicants', async () => {
    expect(FULL_MATCH_TIP).toBe('Add a full match video now — it’s what clubs ask for most after an application.')
    sent()
    const tip = await screen.findByTestId('full-match-nudge')
    expect(tip).toHaveTextContent(FULL_MATCH_TIP)
    expect(document.body.textContent).not.toMatch(/applicants/i)
  })
})

// ── C. Coach role detail header ──────────────────────────────────────────
describe('Role detail header', () => {
  const detail = (p: Partial<Vacancy>) =>
    render(
      <MemoryRouter>
        <OpportunityDetailMobile vacancy={{ ...vacancy, ...p } as Vacancy} clubName="Hockey Team Bologna" clubLogo={null} clubId="club-1" publisherRole="club"
          countryFlag={null} league={null} hasApplied={false} applicationStatus={null} canApply isPublisher={false} onApply={() => {}} onMessage={() => {}} />
      </MemoryRouter>,
    )

  it('coach role: specialisation as text + the soft-purple team Tag, like a player role', () => {
    authState = { user: { id: 'me' }, profile: { id: 'me', role: 'coach' } }
    detail({ opportunity_type: 'coach', position: 'head_coach', gender: 'Men', title: 'Head coach wanted' } as Partial<Vacancy>)
    expect(screen.getByTestId('role-title')).toHaveTextContent('Head coach wanted')
    expect(screen.getByTestId('role-detail-position')).toHaveTextContent(/head coach/i)
    const tag = screen.getByTestId('role-detail-team-tag')
    expect(tag).toHaveTextContent("Men's")
    expect(tag.className).toContain('bg-brand-soft')
    expect(tag.className).toContain('text-brand-primary')
    expect(screen.queryByText("Head coach · Men's")).toBeNull()
  })

  it('player role keeps the same treatment', () => {
    detail({})
    expect(screen.getByTestId('role-detail-position')).toHaveTextContent('Forward')
    expect(screen.getByTestId('role-detail-team-tag')).toHaveTextContent("Women's")
  })
})
