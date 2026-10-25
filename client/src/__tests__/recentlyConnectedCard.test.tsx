import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RecentlyConnectedCard from '@/components/RecentlyConnectedCard'
import type { ReferenceFriendOption } from '@/components/AddReferenceModal'

vi.mock('@/lib/analytics', () => ({
  trackReferenceModalOpen: vi.fn(),
  trackReferenceNudgeDismiss: vi.fn(),
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
}))

vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role?: string | null }) => (role ? <span>{role}</span> : null),
}))

const OWNER_ID = 'owner-1'
const OTHER_OWNER_ID = 'owner-2'

const baseFriend: ReferenceFriendOption = {
  id: 'friend-1',
  fullName: 'Jamie Keeper',
  username: 'jamie',
  avatarUrl: null,
  role: 'coach',
  baseLocation: 'London',
  currentClub: 'Hockia FC',
  acceptedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RecentlyConnectedCard', () => {
  it('renders nothing when the owner already has accepted references', () => {
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={1}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no recent friends inside the window', () => {
    const stale: ReferenceFriendOption = {
      ...baseFriend,
      acceptedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    }
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[stale]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when ownerProfileId is empty', () => {
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId=""
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when friend acceptedAt is null', () => {
    const noTimestamp: ReferenceFriendOption = { ...baseFriend, acceptedAt: null }
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[noTimestamp]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the friend\'s display name is the orphan-profile placeholder', () => {
    // useReferenceFriendOptions / FriendsTab fall back to "Hockia Member"
    // when full_name AND username are both null. Surfacing such a friend
    // would render "Ask Hockia for a reference?" which reads wrong and
    // exposes orphan / abandoned profiles to the nudge.
    const orphan: ReferenceFriendOption = { ...baseFriend, fullName: 'Hockia Member' }
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[orphan]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('runs a one-shot legacy localStorage cleanup on first mount', () => {
    // Before the owner-scope migration, dismiss keys looked like
    // "hockia-recently-connected-dismiss:<friendId>" (one colon). After
    // the migration the format has two colons. Legacy keys are dead but
    // would otherwise sit forever — sweep them on first mount.
    window.localStorage.setItem('hockia-recently-connected-dismiss:legacy-friend-1', new Date().toISOString())
    window.localStorage.setItem('hockia-recently-connected-dismiss:owner-9:friend-9', new Date().toISOString())

    render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )

    expect(window.localStorage.getItem('hockia-recently-connected-dismiss:legacy-friend-1')).toBeNull()
    // Scoped keys (two colons) survive.
    expect(window.localStorage.getItem('hockia-recently-connected-dismiss:owner-9:friend-9')).not.toBeNull()
    // Cleanup flag set so the sweep doesn't repeat.
    expect(window.localStorage.getItem('hockia-recently-connected-cleanup-v1')).toBe('1')
  })

  it('renders nothing when friend acceptedAt is malformed', () => {
    const malformed: ReferenceFriendOption = { ...baseFriend, acceptedAt: 'not-a-date' }
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[malformed]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('never offers the owner themself as a candidate (defence-in-depth)', () => {
    const selfFriend: ReferenceFriendOption = { ...baseFriend, id: OWNER_ID }
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[selfFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('promotes the most recent un-asked friend as the candidate', () => {
    render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getByText('Jamie Keeper')).toBeInTheDocument()
    expect(screen.getByText(/Ask Jamie for a reference/i)).toBeInTheDocument()
  })

  it('picks the most recent friend when multiple are eligible', () => {
    const older: ReferenceFriendOption = {
      ...baseFriend,
      id: 'friend-older',
      fullName: 'Older Coach',
      acceptedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    }
    const newer: ReferenceFriendOption = {
      ...baseFriend,
      id: 'friend-newer',
      fullName: 'Fresh Captain',
      acceptedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    }
    render(
      <RecentlyConnectedCard
        friendOptions={[older, newer]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getByText('Fresh Captain')).toBeInTheDocument()
    expect(screen.queryByText('Older Coach')).not.toBeInTheDocument()
  })

  it('excludes friends already in pending or accepted references', () => {
    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        excludeIds={new Set(['friend-1'])}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('fires onAsk with the friend id when the CTA is clicked', () => {
    const onAsk = vi.fn()
    render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={onAsk}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ask to vouch/i }))
    expect(onAsk).toHaveBeenCalledWith('friend-1')
  })

  it('hides the friend in-session after Ask click but does NOT persist (so cancel/error does not silently suppress the nudge)', () => {
    // Tapping Ask should not write to localStorage — only the X button does.
    // If the user opens the modal and cancels, or the server rejects the
    // request (rate limit, etc.), the candidate must come back on next mount
    // so the user can try again. The session-only suppression handles the
    // common case where they DO submit successfully and we want the card to
    // disappear immediately while the parent's references hook catches up.
    const { unmount } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ask to vouch/i }))
    expect(screen.queryByText('Jamie Keeper')).not.toBeInTheDocument()
    unmount()

    // Simulating a fresh navigation back to the dashboard with the same data
    // (e.g., user cancelled the modal). Friend should reappear because the
    // Ask click only suppressed the candidate for the in-memory session.
    render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getByText('Jamie Keeper')).toBeInTheDocument()
  })

  it('hides the card after dismiss and remembers the dismissal across remount', () => {
    const { unmount } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss this nudge/i }))
    expect(screen.queryByText('Jamie Keeper')).not.toBeInTheDocument()
    unmount()

    const { container } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('scopes dismissal by ownerProfileId so a different signed-in user still sees the nudge', () => {
    const { unmount } = render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss this nudge/i }))
    unmount()

    // Same browser, same friend, different signed-in user — must still see
    // the nudge. (Pre-fix, dismissal leaked across users.)
    render(
      <RecentlyConnectedCard
        friendOptions={[baseFriend]}
        ownerProfileId={OTHER_OWNER_ID}
        acceptedReferenceCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getByText('Jamie Keeper')).toBeInTheDocument()
  })
})
