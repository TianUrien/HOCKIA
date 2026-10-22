/**
 * Design audit 2026-10-21, B4: one desktop inbox. /inbox, /inbox/:segment,
 * /messages and /messages/:conversationId keep working; on desktop they all
 * render the master-detail page (segments in the left column, the thread on
 * the right); phones keep the Inbox tab. One conversation row everywhere: one
 * time format, one unread dot, the batch C avatar, the applicant context line.
 */
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Route, Routes, matchPath } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isPhone: false }))

vi.mock('@/lib/supabase', () => ({ supabase: {}, SUPABASE_URL: 'https://example.supabase.co' }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => mocks.isPhone }))
vi.mock('@/pages/MessagesPage', () => ({ default: () => <div data-testid="desktop-inbox">master-detail</div> }))
vi.mock('@/components', () => ({ Header: () => null, NewMessageModal: () => null }))
vi.mock('@/components/inbox/InboxMessages', () => ({ InboxMessages: () => <div data-testid="phone-messages" /> }))
vi.mock('@/components/inbox/InboxActivity', () => ({ InboxActivity: () => <div data-testid="phone-activity" /> }))
vi.mock('@/components/inbox/InboxSegments', () => ({
  InboxSegmentControl: ({ value }: { value: string }) => <div data-testid="segments">{value}</div>,
  InboxRequestsSegment: () => <div data-testid="phone-requests" />,
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { profile: { id: 'v1', role: 'player' } }; return sel ? sel(s) : s } }))
vi.mock('@/hooks/friendshipEdgeCache', () => ({ loadFriendshipEdges: vi.fn(async () => {}) }))
vi.mock('@/hooks/useScrollRestore', () => ({ useScrollRestore: () => undefined }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => undefined }))

import InboxPage from '@/pages/InboxPage'
import { inboxSegmentFromPath, inboxSegmentPath } from '@/lib/inboxSegments'
import { ConversationRow } from '@/components/inbox/ConversationRow'
import ConversationList from '@/components/ConversationList'

const APP = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:segment" element={<InboxPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('inbox routes', () => {
  beforeEach(() => { mocks.isPhone = false })

  it('App keeps all four routes, /inbox on InboxPage and /messages on MessagesPage', () => {
    for (const path of ['/inbox', '/inbox/:segment', '/messages', '/messages/:conversationId']) {
      expect(APP).toContain(`<Route path="${path}"`)
    }
    expect(APP).toMatch(/path="\/inbox\/:segment" element=\{[^\n]*<InboxPage \/>/)
    expect(APP).toMatch(/path="\/messages\/:conversationId" element=\{[^\n]*<MessagesPage \/>/)
  })

  it('desktop: /inbox and every segment render the one master-detail inbox', () => {
    for (const path of ['/inbox', '/inbox/requests', '/inbox/activity']) {
      const view = at(path)
      expect(screen.getByTestId('desktop-inbox')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('phones keep the Inbox tab and its segments', () => {
    mocks.isPhone = true
    at('/inbox/requests')
    expect(screen.queryByTestId('desktop-inbox')).toBeNull()
    expect(screen.getByTestId('segments')).toHaveTextContent('requests')
    expect(screen.getByTestId('phone-requests')).toBeInTheDocument()
  })

  it('segment paths round-trip; a thread belongs to Messages', () => {
    expect(inboxSegmentFromPath('/inbox')).toBe('messages')
    expect(inboxSegmentFromPath('/inbox/requests')).toBe('requests')
    expect(inboxSegmentFromPath('/inbox/activity')).toBe('activity')
    expect(inboxSegmentFromPath('/inbox/nonsense')).toBe('messages')
    expect(inboxSegmentFromPath('/messages/abc')).toBe('messages')
    for (const seg of ['messages', 'requests', 'activity'] as const) {
      const path = inboxSegmentPath(seg)
      expect(inboxSegmentFromPath(path)).toBe(seg)
      expect(matchPath({ path: seg === 'messages' ? '/inbox' : '/inbox/:segment', end: true }, path)).not.toBeNull()
    }
  })
})

describe('one conversation row', () => {
  const now = new Date()
  it('phone and desktop rows share the time format, the unread dot and the context line', () => {
    const iso = now.toISOString()
    const { container } = render(
      <ConversationList
        currentUserId="me"
        selectedConversationId="c1"
        onSelectConversation={() => {}}
        clubMeta={new Map([['c1', { detail: 'midfielder', applied: true, waiting: false }]])}
        conversations={[{
          id: 'c1', participant_one_id: 'me', participant_two_id: 'p1', created_at: iso, updated_at: iso, last_message_at: iso,
          otherParticipant: { id: 'p1', full_name: 'Ana Ruiz', username: null, avatar_url: null, role: 'player' },
          lastMessage: { content: 'See you Saturday', sent_at: iso, sender_id: 'p1' },
          unreadCount: 2,
        }]}
      />,
    )
    const row = screen.getByTestId('conversation-item')
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row.textContent).toContain('Player · Midfielder · Applied')
    expect(screen.getByTestId('inbox-unread-dot')).toBeInTheDocument()
    // Never a number for unread.
    expect(row.textContent).not.toMatch(/\b2\b/)
    const phone = render(
      <ConversationRow name="Ana Ruiz" avatarUrl={null} role="player" at={iso} contextLine="Player" preview="See you Saturday" unread onSelect={() => {}} />,
    )
    const phoneDates = phone.container.querySelectorAll('[data-testid="conversation-date"]')
    expect(phoneDates[0].textContent).toBe(container.querySelector('[data-testid="conversation-date"]')!.textContent)
  })

  it('the desktop list no longer uses its own relative time', () => {
    const list = readFileSync(resolve(__dirname, '../components/ConversationList.tsx'), 'utf8')
    expect(list).not.toContain('formatDistanceToNow')
    expect(list).toContain('<ConversationRow')
  })
})
