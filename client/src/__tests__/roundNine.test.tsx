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
import { recruitingPreview, recruitingPreviewLine, shortDayOf } from '@/lib/signing'
import { clockTime, dayFirst } from '@/lib/dayFirst'
import { formatActivityAge, formatInboxTime } from '@/lib/inboxTime'
import { getTimeAgo } from '@/lib/utils'
import { appliedLine, appliedOnLine, deadlineLine, postedLine, startsLine, whenLine } from '@/lib/opportunityCopy'
import { startLabel } from '@/lib/postRole'
import { offerRingTarget } from '@/features/chat-v2/utils'

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

// ── 2 · Day-first dates through one helper; one clock ────────────────────────
describe('2 · dayFirst is the one date helper outside the signing road', () => {
  const now = new Date(2026, 9, 3, 12) // 3 Oct 2026, local

  it('"3 Oct" this year, "3 Oct 2026" otherwise; year can be forced on or off', () => {
    expect(dayFirst('2026-10-03', { now })).toBe('3 Oct')
    expect(dayFirst('2027-01-15', { now })).toBe('15 Jan 2027')
    expect(dayFirst('2026-10-03', { now, year: 'always' })).toBe('3 Oct 2026')
    expect(dayFirst('2027-01-15', { now, year: 'never' })).toBe('15 Jan')
    expect(dayFirst(new Date(2026, 6, 9), { now })).toBe('9 Jul')
    expect(dayFirst(null)).toBeNull()
    expect(dayFirst('not a date')).toBeNull()
  })

  it('a date-only string is a local calendar day (no timezone shift); a timestamp is local time', () => {
    const d = dayFirst('2026-10-03', { now, year: 'always' })
    expect(d).toBe('3 Oct 2026')
    // Same calendar day as the road's own formatter for a timestamp.
    const iso = '2026-10-03T10:04:00Z'
    expect(dayFirst(iso, { now })).toBe(shortDayOf(iso, now))
  })

  it('the inbox list and the chat bubbles share the clock', () => {
    const today = new Date(now)
    today.setHours(10, 4, 0, 0)
    expect(clockTime(today)).toMatch(/^10:04 [AP]M$/)
    expect(formatInboxTime(today.toISOString(), now)).toBe(clockTime(today))
    const bubble = src('features/chat-v2/components/MessageBubble.tsx')
    expect(bubble).toContain('clockTime(message.sent_at)')
    expect(bubble).not.toContain("'h:mm a'")
    expect(bubble).not.toContain("'HH:mm'")
    expect(src('lib/inboxTime.ts')).not.toContain("'HH:mm'")
  })

  it('inbox and activity rows read day first', () => {
    expect(formatInboxTime('2026-06-12T09:00:00Z', now)).toBe('12 Jun')
    expect(formatInboxTime('2025-09-25T09:00:00Z', now)).toBe('25 Sep 2025')
    expect(formatActivityAge('2026-06-12T09:00:00Z', now)).toBe('12 Jun')
    expect(formatActivityAge('2025-09-25T09:00:00Z', now)).toBe('25 Sep 2025')
  })

  it('role copy: Starts / Apply by / Closed / Applied / the Post-a-role start summary', () => {
    expect(startsLine({ start_date: '2026-10-10', duration_text: null })).toBe('Starts 10 Oct 2026')
    expect(deadlineLine({ application_deadline: '2026-10-03' })).toBe('Apply by 3 Oct 2026')
    expect(postedLine({ created_at: '2026-09-30T12:00:00Z', application_deadline: null, closed_at: '2026-10-03T12:00:00Z' }, now, true)).toBe('Posted 3 days ago · Closed 3 Oct 2026')
    expect(whenLine({ start_date: '2026-09-16', duration_text: '3' }, now)).toBe('16 Sep · 3 months')
    expect(appliedOnLine('2026-09-03T12:00:00Z')).toBe('Applied 3 Sep 2026')
    expect(appliedLine('2026-08-20T12:00:00Z', now)).toBe('Applied 20 Aug')
    expect(startLabel('2026-10-10', now)).toBe('10 Oct')
  })

  it('"Posted" on the role card after a week reads day first (getTimeAgo compact)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      expect(getTimeAgo('2026-07-09T12:00:00Z', true)).toBe('9 Jul')
      expect(getTimeAgo('2025-07-09T12:00:00Z', true)).toBe('9 Jul 2025')
    } finally {
      vi.useRealTimers()
    }
  })

  it('no month-first formatter remains on the in-scope surfaces', () => {
    const monthFirst = /month: 'short', day: 'numeric'|month: 'long', day: 'numeric'|'MMM d|'MMMM d/
    for (const p of [
      'components/OpportunityDetailView.tsx', 'components/ApplicantCard.tsx', 'components/ApplicationTimeline.tsx',
      'components/OpportunitiesTab.tsx', 'components/brands/BrandCard.tsx', 'components/UmpireAppointmentsSection.tsx',
      'components/TrustedReferencesSection.tsx', 'lib/opportunityCopy.ts', 'lib/inboxTime.ts', 'lib/postRole.ts',
      'features/chat-v2/components/MessageBubble.tsx',
    ]) {
      expect(src(p), p).not.toMatch(monthFirst)
      expect(src(p), p).toContain('dayFirst')
    }
    expect(src('lib/utils.ts')).toContain('dayFirst(date, { now })')
  })
})

// ── 3 · "See the offer" rings the card, not the separator ────────────────────
describe('3 · the highlight ring wraps the offer card only', () => {
  it('offerRingTarget picks the card inside the message row; a row without one rings whole', () => {
    const row = document.createElement('div')
    row.setAttribute('data-message-id', 'm-1')
    row.innerHTML = '<div class="py-3">Today</div><div class="py-2">10:04 AM</div><div class="flex"><div data-offer-card="true"><article>Offer</article></div></div>'
    const card = row.querySelector('[data-offer-card]') as HTMLElement
    expect(offerRingTarget(row)).toBe(card)
    expect(card.textContent).toBe('Offer')
    expect(card.contains(row.firstElementChild)).toBe(false)
    const bare = document.createElement('div')
    expect(offerRingTarget(bare)).toBe(bare)
  })
  it('MessageBubble marks the offer card and ChatWindowV2 rings through the helper', () => {
    expect(src('features/chat-v2/components/MessageBubble.tsx')).toContain('data-offer-card="true"')
    const win = src('features/chat-v2/ChatWindowV2.tsx')
    expect(win).toContain('const node = offerRingTarget(row)')
    expect(win).toContain('node.classList.add(...ANCHOR_HIGHLIGHT)')
    expect(win).toContain("node.scrollIntoView({ block: 'center' })")
  })
})
