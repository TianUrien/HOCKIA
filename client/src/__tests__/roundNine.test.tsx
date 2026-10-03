import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Round 9 (QA re-check of round 7 on 854820c3): the club's inbox preview of
 * a signing line is written for the club and carries no "You:" prefix (the
 * phone InboxMessages list had kept the raw player-worded line); day-first
 * dates everywhere outside the signing road, through one helper; the inbox
 * list and the chat bubbles share one clock; the "See the offer" ring wraps
 * the offer card only; Withdraw application opens on the first tap.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
const viewer = { id: 'club-1', role: 'club' as string }
const rpcRows: unknown[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: rpcRows, error: null })),
  },
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { profile: { id: viewer.id, role: viewer.role }, user: { id: viewer.id } }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/useClubInbox', () => ({ useClubInboxMeta: () => ({ data: undefined }) }))

import { InboxMessages } from '@/components/inbox/InboxMessages'
import { recruitingPreview, recruitingPreviewLine } from '@/lib/signing'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

const SIGNED_LINE = 'E2E Test FC marked you as signed for [QA] R7 Future. Confirm it on Hockia to add the signing to your career.'

function row(over: Record<string, unknown>) {
  return {
    conversation_id: 'c-1',
    other_participant_id: 'p-1',
    other_participant_name: 'Facundo Pérez',
    other_participant_username: 'facundo',
    other_participant_avatar: null,
    other_participant_role: 'player',
    last_message_content: SIGNED_LINE,
    last_message_sent_at: '2026-10-03T10:04:00Z',
    last_message_sender_id: 'club-1',
    unread_count: 0,
    conversation_created_at: '2026-10-01T10:00:00Z',
    conversation_updated_at: '2026-10-03T10:04:00Z',
    conversation_last_message_at: '2026-10-03T10:04:00Z',
    ...over,
  }
}

function renderInbox() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InboxMessages onCompose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── 1 · Club inbox preview of a signing line ─────────────────────────────────
describe('1 · the inbox preview of a recruiting line reads for its viewer, without a sender prefix', () => {
  beforeEach(() => {
    rpcRows.length = 0
    viewer.id = 'club-1'
    viewer.role = 'club'
  })

  it('helper: the club reads its own step, the player the server line; both flagged system', () => {
    expect(recruitingPreview(SIGNED_LINE, { isMine: true, otherFirstName: 'Facundo' })).toEqual({
      text: 'You marked Facundo as signed for [QA] R7 Future. Waiting for them to confirm.',
      system: true,
    })
    expect(recruitingPreview(SIGNED_LINE, { isMine: false, otherFirstName: 'E2E' })).toEqual({ text: SIGNED_LINE, system: true })
    // A human line keeps its prefix.
    expect(recruitingPreview('See you at training', { isMine: true, otherFirstName: 'Facundo' })).toEqual({ text: 'See you at training', system: false })
    // Round 7's string form still answers.
    expect(recruitingPreviewLine(SIGNED_LINE, { isMine: true, otherFirstName: 'Facundo' })).toBe('You marked Facundo as signed for [QA] R7 Future. Waiting for them to confirm.')
  })

  it('helper: the other player-worded server lines (offer, invite) are reworded for the club only', () => {
    const offer = 'E2E Test FC sent you an offer for [QA] R7 Future, open until 9 Oct. Open Hockia to see the terms and answer.'
    expect(recruitingPreview(offer, { isMine: true, otherFirstName: 'Facundo' })).toEqual({ text: 'You sent an offer for [QA] R7 Future, open until 9 Oct.', system: true })
    expect(recruitingPreview(offer.replace('sent you an offer', 'updated its offer'), { isMine: true })).toEqual({ text: 'You updated your offer for [QA] R7 Future, open until 9 Oct.', system: true })
    expect(recruitingPreview(offer, { isMine: false })).toEqual({ text: offer, system: true })
    const invite = 'E2E Test FC invited you to apply for [QA] R7 Future.\n\nCome and see us.\n\nOpen the role on Hockia to apply or say you’re not interested.'
    expect(recruitingPreview(invite, { isMine: true, otherFirstName: 'Facundo' })).toEqual({ text: 'You invited Facundo to apply for [QA] R7 Future.', system: true })
    expect(recruitingPreview(invite, { isMine: false })).toEqual({ text: invite, system: true })
    // Neutral server lines are untouched but still lose the prefix.
    expect(recruitingPreview('Facundo Pérez passed on [QA] R7 Future.', { isMine: false })).toEqual({ text: 'Facundo Pérez passed on [QA] R7 Future.', system: true })
    expect(recruitingPreview('Facundo Pérez confirmed the signing for [QA] R7 Future. Signed through Hockia.', { isMine: false }).system).toBe(true)
  })

  it('club views the signed-pending line: its own words, no "You:"', async () => {
    rpcRows.push(row({}))
    renderInbox()
    const line = await screen.findByText('You marked Facundo as signed for [QA] R7 Future. Waiting for them to confirm.')
    expect(line.textContent).not.toMatch(/^You:/)
    expect(screen.queryByText(/marked you as signed/)).toBeNull()
  })

  it('coach thread: same wording with the coach’s first name', async () => {
    rpcRows.push(row({ other_participant_name: 'Marta Ruiz', other_participant_role: 'coach', last_message_content: SIGNED_LINE.replace('[QA] R7 Future', '[QA] R7 Coach') }))
    renderInbox()
    await screen.findByText('You marked Marta as signed for [QA] R7 Coach. Waiting for them to confirm.')
    expect(screen.queryByText(/^You:/)).toBeNull()
  })

  it('player view unchanged: the server line as written, no prefix', async () => {
    viewer.id = 'p-1'
    viewer.role = 'player'
    rpcRows.push(row({ other_participant_id: 'club-1', other_participant_name: 'E2E Test FC', other_participant_role: 'club' }))
    renderInbox()
    const line = await screen.findByText(SIGNED_LINE)
    expect(line.textContent).toBe(SIGNED_LINE)
  })

  it('an ordinary message the club wrote keeps "You:"', async () => {
    rpcRows.push(row({ last_message_content: 'See you at training' }))
    renderInbox()
    await waitFor(() => expect(screen.getByText('You: See you at training')).toBeTruthy())
  })

  it('the desktop list reads the same helper and gates its prefix on the flag', () => {
    const list = src('components/ConversationList.tsx')
    expect(list).toContain('recruitingPreview(conversation.lastMessage.content')
    expect(list).toContain('!preview.system')
    const inbox = src('components/inbox/InboxMessages.tsx')
    expect(inbox).toContain('recruitingPreview(row.last_message_content')
    expect(inbox).toContain("mine && !line.system ? 'You: ' : ''")
  })
})
