/**
 * Regression: in a thread that holds D3 invite cards and server-posted step
 * lines, the options menu on the player's own message must open and stay
 * open while the thread scrolls on its own (the auto-scroll after a send,
 * invite cards growing from their placeholder). It used to close on the
 * first scroll event, a frame after opening.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/types/chat'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }) }))
// The card is still loading (its 260px placeholder), as when the thread first opens.
vi.mock('@/hooks/useInvites', () => ({
  INVITES_KEY: ['invites'],
  inviteCardKey: (id: string) => ['invites', 'card', id],
  useInviteCard: () => ({ data: null, loading: true, refetch: vi.fn() }),
  useDeclineInvite: () => ({ decline: vi.fn(), busy: false }),
}))

import { MessageList } from '@/features/chat-v2/components/MessageList'

const PLAYER = 'player-1'
const CLUB = 'club-1'

// Same shapes as the staging thread between E2E Test FC and E2E Test Player.
const messages: ChatMessage[] = [
  {
    id: 'm-invite', conversation_id: 'c1', sender_id: CLUB, read_at: null, sent_at: '2026-10-01T19:00:25Z',
    content: 'E2E Test FC invited you to apply for [QA] Invite D.\n\nHi E2E, we’re recruiting a midfielder.',
    metadata: { type: 'opportunity_invite', invite_id: 'inv-d', opportunity_id: 'opp-d' },
  },
  {
    id: 'm-step', conversation_id: 'c1', sender_id: PLAYER, read_at: null, sent_at: '2026-10-01T19:02:41Z',
    content: 'E2E Test Player passed on [QA] Invite D.',
    metadata: { type: 'application_event', event: 'invite_declined', invite_id: 'inv-d', opportunity_id: 'opp-d' },
  },
  {
    id: 'm-own', conversation_id: 'c1', sender_id: PLAYER, read_at: null, sent_at: '2026-10-01T19:54:33Z',
    content: 'E2E edit/delete 1790884472987', metadata: null,
  },
]

function Thread() {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={ref} className="chat-scroll-container" data-testid="scroller">
      <MessageList
        messages={messages}
        currentUserId={PLAYER}
        scrollContainerRef={ref}
        queueReadReceipt={vi.fn()}
        retryMessage={vi.fn()}
        deleteFailedMessage={vi.fn()}
        editMessage={vi.fn().mockResolvedValue(true)}
        deleteMessage={vi.fn().mockResolvedValue(true)}
        isLoadingMore={false}
        unreadMetadata={{ firstUnreadId: null, unreadCount: 0 }}
      />
    </div>
  )
}

const rect = (top: number, bottom: number, right = 300) =>
  ({ top, bottom, left: right - 24, right, width: 24, height: bottom - top, x: right - 24, y: top, toJSON: () => ({}) }) as DOMRect

/** jsdom has no layout: give the thread and the trigger real-looking rects. */
function layout(triggerTop: () => number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('chat-scroll-container')) return rect(0, 600, 400)
    if (this.getAttribute('data-testid') === 'message-options-trigger') return rect(triggerTop(), triggerTop() + 24)
    return rect(0, 0)
  })
}

const nextFrames = () => act(() => new Promise<void>((r) => setTimeout(r, 50)))

describe('chat options menu in a thread with invite cards and step lines', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens Edit + Delete on the own message and keeps them open while the thread scrolls', async () => {
    let top = 520
    layout(() => top)
    render(<Thread />)

    // The invite card (lazy, placeholder) and the step line are in the thread…
    expect(await screen.findByTestId('invite-card-loading')).toBeTruthy()
    expect(screen.getByTestId('recruiting-event-line').textContent).toBe('E2E Test Player passed on [QA] Invite D.')
    // …and only the plain own message can be managed.
    const triggers = screen.getAllByTestId('message-options-trigger')
    expect(triggers).toHaveLength(1)

    fireEvent.click(triggers[0])
    expect(screen.getByTestId('message-edit-action')).toBeTruthy()
    expect(screen.getByTestId('message-delete-action')).toBeTruthy()

    // The auto-scroll to the newest message / a card growing moves the trigger.
    const scroller = screen.getByTestId('scroller')
    for (const t of [480, 440, 410]) {
      top = t
      fireEvent.scroll(scroller)
      await nextFrames()
    }
    fireEvent(window, new Event('resize'))
    await nextFrames()

    expect(screen.getByTestId('message-edit-action')).toBeTruthy()
    expect(screen.getByTestId('message-delete-action')).toBeTruthy()

    // The menu follows its trigger (opens upward: bottom = viewport − trigger top + 6).
    const menu = screen.getByTestId('message-edit-action').parentElement as HTMLElement
    expect(menu.style.bottom).toBe(`${window.innerHeight - 410 + 6}px`)

    fireEvent.click(screen.getByTestId('message-edit-action'))
    expect(screen.getByTestId('message-edit-editor')).toBeTruthy()
  })

  it('closes once the trigger scrolls out of the visible thread', async () => {
    let top = 520
    layout(() => top)
    render(<Thread />)
    await screen.findByTestId('invite-card-loading')

    fireEvent.click(screen.getByTestId('message-options-trigger'))
    expect(screen.getByTestId('message-delete-action')).toBeTruthy()

    top = 700 // below the thread's visible bottom (600)
    fireEvent.scroll(screen.getByTestId('scroller'))
    await waitFor(() => expect(screen.queryByTestId('message-delete-action')).toBeNull())
  })
})
