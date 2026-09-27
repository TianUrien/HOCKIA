import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Phase 2 polish:
 *   1. Report is one "…" item + one sheet everywhere (reason + optional note).
 *   2. Blocked / hidden friend requests read "This person isn't accepting requests."
 *   3. One lock badge on video thumbnails, readable on dark and bright frames.
 *   4. Amber only when the VIEWER must act soon (viewer-dependent tones).
 */

const h = vi.hoisted(() => ({ rpc: vi.fn(), addToast: vi.fn(), user: { id: 'viewer-1' } as { id: string } | null }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  },
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: h.user, profile: h.user ? { id: h.user.id, role: 'player' } : null }
    return typeof sel === 'function' ? sel(state) : state
  },
}))
vi.mock('@/lib/toast', () => ({
  useToastStore: (sel?: (s: unknown) => unknown) => {
    const state = { addToast: h.addToast }
    return typeof sel === 'function' ? sel(state) : state
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { REPORT_REASONS, REPORT_THANKS, buildReportPayload, canReport } from '@/lib/report'
import { ReportSheet } from '@/components/safety/ReportSheet'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import { ChatHeader } from '@/features/chat-v2/components/ChatHeader'
import { FRIEND_REQUEST_BLOCKED_MESSAGE, friendRequestErrorMessage, isFriendRequestBlockedError } from '@/lib/friendshipErrors'
import { extractErrorMessage } from '@/lib/utils'
import { VideoLockBadge } from '@/components/profile/mobile/VideoLockBadge'
import { invitationPendingTone, noReplyTone, pendingVerificationTone, STATUS_TONE_PILL } from '@/lib/statusTone'
import { isClubReplyUrgent, clubReplyLineClass } from '@/lib/clubRecruiting'
import { applicationStatusPill } from '@/lib/opportunityCopy'
import PendingVerificationBadge from '@/components/PendingVerificationBadge'
import Toast from '@/components/Toast'
import { friendRequestToastType } from '@/lib/friendshipErrors'
import { BENEFIT_TILES } from '@/lib/opportunityCopy'
import { CATEGORY_COLORS } from '@/types/questions'
import { ROLE_COLOR_PALETTE } from '@/lib/roleColors'
import RoleBadge from '@/components/RoleBadge'
import { MoreMenu } from '@/components/safety/MoreMenu'

/** Labels of an open "…" menu (phone sheet in jsdom: max-width queries match). */
async function menuItems(testId: string): Promise<string[]> {
  const sheet = await screen.findByTestId(`${testId}-sheet`)
  return Array.from(sheet.querySelectorAll('button')).map((b) => b.textContent ?? '').filter((t) => t !== 'Cancel')
}

beforeEach(() => {
  h.rpc.mockReset()
  h.addToast.mockReset()
  h.user = { id: 'viewer-1' }
})

describe('1 · Report', () => {
  it('builds the report_user payload: note optional, chats and roles file against the person', () => {
    expect(buildReportPayload({ targetId: 'u2', subject: 'profile', reason: 'spam' })).toEqual({
      p_target_id: 'u2', p_reason: 'Spam or scam', p_category: 'spam', p_content_type: 'user', p_content_id: null,
    })
    expect(buildReportPayload({ targetId: 'u2', subject: 'post', reason: 'harassment', note: '  rude  ', contentId: 'p1' })).toMatchObject({
      p_reason: 'rude', p_content_type: 'post', p_content_id: 'p1',
    })
    expect(buildReportPayload({ targetId: 'club', subject: 'role', reason: 'spam', contentId: 'opp-1' })).toMatchObject({
      p_reason: '[Role opp-1] Spam or scam', p_content_type: 'user', p_content_id: null,
    })
    expect(buildReportPayload({ targetId: 'u3', subject: 'chat', reason: 'spam', note: 'asked for money', contentId: 'conv-9' }).p_reason)
      .toBe('[Chat conv-9] asked for money')
  })

  it('every reason is a category the user_reports CHECK accepts', () => {
    const allowed = ['harassment', 'spam', 'inappropriate_content', 'impersonation', 'hate_speech', 'violence', 'misinformation', 'other']
    for (const r of REPORT_REASONS) expect(allowed).toContain(r.value)
  })

  it('never offers Report on your own things', () => {
    expect(canReport('a', 'a')).toBe(false)
    expect(canReport(null, 'a')).toBe(false)
    expect(canReport('a', 'b')).toBe(true)
  })

  it('the sheet sends with a reason alone, then toasts the thanks and closes', async () => {
    h.rpc.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    render(<ReportSheet open onClose={onClose} targetId="u2" subject="chat" contentId="conv-1" />)
    const send = screen.getByRole('button', { name: 'Send report' })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Spam or scam' }))
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(REPORT_THANKS, 'success'))
    expect(REPORT_THANKS).toBe("Thanks. We'll review it.")
    expect(h.rpc).toHaveBeenCalledWith('report_user', expect.objectContaining({ p_target_id: 'u2', p_category: 'spam', p_reason: '[Chat conv-1] Spam or scam' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('profile "…" says Report + Block, and is absent on your own profile', async () => {
    h.rpc.mockResolvedValue({ data: false })
    const { rerender } = render(<MemoryRouter><ProfileActionMenu targetId="someone" targetName="Someone" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await menuItems('profile-more-menu')).toEqual(['Report', 'Block'])

    rerender(<MemoryRouter><ProfileActionMenu targetId="viewer-1" targetName="Me" /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('applicant review "…" = Message · View full profile · Report (no Block)', async () => {
    h.rpc.mockResolvedValue({ data: false })
    const onMessage = vi.fn()
    render(
      <MemoryRouter>
        <ProfileActionMenu
          targetId="applicant"
          targetName="Applicant"
          showBlock={false}
          leadingItems={[
            { key: 'message', label: 'Message', onSelect: onMessage },
            { key: 'profile', label: 'View full profile', onSelect: vi.fn() },
          ]}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await menuItems('profile-more-menu')).toEqual(['Message', 'View full profile', 'Report'])
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(await screen.findByRole('heading', { name: 'Report this profile' })).toBeInTheDocument()
  })

  it('chat header "…" offers View profile + Report', async () => {
    render(
      <MemoryRouter>
        <ChatHeader
          participant={{ id: 'u9', full_name: 'Pat Doe', username: null, avatar_url: null, role: 'player' } as never}
          onBack={vi.fn()}
          profilePath="/players/id/u9"
          isMobile={false}
          conversationId="conv-1"
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    expect(await menuItems('chat-more-menu')).toEqual(['View profile', 'Report'])
  })
})

describe('2 · Blocked friend requests', () => {
  const raw = [
    'Cannot send a friend request to a user you have blocked or who has blocked you.',
    'This user is not available right now.',
  ]
  it.each(raw)('maps "%s" to the one friendly line', (message) => {
    expect(isFriendRequestBlockedError({ message })).toBe(true)
    expect(friendRequestErrorMessage({ message, code: '23514' }, 'fallback')).toBe(FRIEND_REQUEST_BLOCKED_MESSAGE)
    expect(extractErrorMessage({ message }, 'fallback')).toBe("This person isn't accepting requests.")
  })

  it('keeps other failures on their friendly fallback', () => {
    expect(friendRequestErrorMessage({ message: 'relation "x" does not exist' }, 'Unable to send friend request.')).not.toBe(FRIEND_REQUEST_BLOCKED_MESSAGE)
    expect(friendRequestErrorMessage(null, 'Unable to send friend request.')).toBe('Unable to send friend request.')
  })

  it('does not swallow the messaging refusal (different text)', () => {
    expect(isFriendRequestBlockedError({ message: 'This user is not available for messaging right now.' })).toBe(false)
  })
})

describe('3 · One lock badge', () => {
  it('is a near-solid dark circle with a thin light ring', () => {
    render(<div className="relative"><VideoLockBadge /><VideoLockBadge size="sm" /></div>)
    const [md, sm] = screen.getAllByTestId('video-lock-badge')
    for (const el of [md, sm]) {
      expect(el.className).toContain('bg-ink-1/90')
      expect(el.className).toContain('ring-1')
      expect(el.className).toContain('ring-white/70')
      expect(el.className).not.toContain('bg-black/55')
    }
    expect(md.className).toContain('h-6')
    expect(sm.className).toContain('h-5')
  })
})

describe('4 · Viewer-dependent colours', () => {
  it('No reply · 14d+ is grey for the player and amber for the club', () => {
    expect(noReplyTone('applicant')).toBe('grey')
    expect(noReplyTone('club')).toBe('amber')
    const now = new Date('2026-09-27T12:00:00Z')
    expect(applicationStatusPill('pending', '2026-09-10T12:00:00Z', true, now)).toMatchObject({ label: 'No reply · 17d', tone: 'grey' })
    expect(isClubReplyUrgent('2026-09-10T12:00:00Z', 20, now)).toBe(true)
    expect(isClubReplyUrgent('2026-09-25T12:00:00Z', 12, now)).toBe(false)
    expect(isClubReplyUrgent('2026-09-25T12:00:00Z', 4, now)).toBe(true)
    expect(clubReplyLineClass(true)).toContain('text-amber-600')
    expect(clubReplyLineClass(false)).toBe('text-ink-3')
  })

  it('Invitation pending is grey; Pending verification is amber only for the verifier', () => {
    expect(invitationPendingTone()).toBe('grey')
    expect(pendingVerificationTone(false)).toBe('grey')
    expect(pendingVerificationTone(true)).toBe('amber')
    expect(STATUS_TONE_PILL.gold).toContain('gold')
  })

  it('the club "Pending verification" badge is grey for visitors, amber for the verifier', () => {
    const { rerender } = render(<PendingVerificationBadge verified={false} />)
    expect(screen.getByLabelText('Pending verification').className).toContain('text-ink-2')
    expect(screen.getByLabelText('Pending verification').className).not.toContain('amber')
    rerender(<PendingVerificationBadge verified={false} viewerMustVerify />)
    expect(screen.getByLabelText('Pending verification').className).toContain('text-amber-600')
  })
})

describe('v2 · founder follow-ups', () => {
  it('the blocked line is a neutral grey toast — no red, no error icon', () => {
    expect(friendRequestToastType(FRIEND_REQUEST_BLOCKED_MESSAGE)).toBe('neutral')
    expect(friendRequestToastType('Unable to send friend request.')).toBe('error')
    render(<Toast message={FRIEND_REQUEST_BLOCKED_MESSAGE} type="neutral" onClose={vi.fn()} duration={0} />)
    const toast = screen.getByRole('alert')
    expect(toast.className).toContain('bg-surface-grouped')
    expect(toast.className).not.toMatch(/red/)
    expect(toast.querySelector('.lucide-circle-x, .lucide-x-circle')).toBeNull()
  })

  it('decorative colours are off amber (one accent per group)', () => {
    expect(BENEFIT_TILES.car.tileClass).toBe('bg-hockia-soft text-hockia-primary')
    expect(BENEFIT_TILES.meals.tileClass).toBe('bg-hockia-soft text-hockia-primary')
    expect(CATEGORY_COLORS.visas_moving_abroad).toEqual({ bg: 'bg-hockia-soft', text: 'text-hockia-primary' })
    expect(ROLE_COLOR_PALETTE.umpire).toEqual({ bg: '#F4F4F7', text: '#5B5B6B' })
    render(<RoleBadge role="umpire" />)
    expect(screen.getByText('Umpire').className).toContain('text-ink-2')
  })

  it('post "…" on phones opens the shared bottom sheet', async () => {
    const onSelect = vi.fn()
    render(<MoreMenu items={[{ key: 'report', label: 'Report', onSelect }]} label="Post options" testId="post-more-menu" />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(await menuItems('post-more-menu')).toEqual(['Report'])
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(onSelect).toHaveBeenCalled()
  })
})
