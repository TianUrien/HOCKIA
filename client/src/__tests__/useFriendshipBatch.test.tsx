import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The community grid mounts one useFriendship per candidate card. This pins
 * the N+1 fix (Sentry AG): ALL mounted hooks share ONE profile_friend_edges
 * query per viewer, each card still resolves its own relationship from the
 * shared map — and mutations made OUTSIDE the hook (notifications panel,
 * FriendsTab, ConnectionsSection) converge every card via
 * invalidateFriendshipEdges().
 */
const edgesSelect = vi.fn()
let edgeRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          edgesSelect(table)
          return Promise.resolve({ data: edgeRows, error: null })
        },
      }),
    }),
  },
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ profile: { id: 'viewer-1' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (sel: (s: { dismissBySource: () => void }) => unknown) =>
    sel({ dismissBySource: vi.fn() }),
}))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))

import { useFriendship } from '@/hooks/useFriendship'
import {
  invalidateFriendshipEdges,
  clearFriendshipEdgeCache,
} from '@/hooks/friendshipEdgeCache'

function Card({ profileId }: { profileId: string }) {
  const { loading, isFriend, isOutgoingRequest } = useFriendship(profileId)
  if (loading) return <div data-testid={`card-${profileId}`}>loading</div>
  return (
    <div data-testid={`card-${profileId}`}>
      {isFriend ? 'friend' : isOutgoingRequest ? 'requested' : 'none'}
    </div>
  )
}

describe('useFriendship shared edge cache', () => {
  beforeEach(() => {
    clearFriendshipEdgeCache()
    edgesSelect.mockClear()
    edgeRows = [
      { friend_id: 'friend-a', status: 'accepted', requester_id: 'viewer-1', id: 'e1' },
      { friend_id: 'friend-b', status: 'pending', requester_id: 'viewer-1', id: 'e2' },
    ]
  })

  it('serves many cards from ONE edges query, each with its own state', async () => {
    render(
      <>
        <Card profileId="friend-a" />
        <Card profileId="friend-b" />
        <Card profileId="stranger-c" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('card-friend-a').textContent).toBe('friend'))
    expect(screen.getByTestId('card-friend-b').textContent).toBe('requested')
    expect(screen.getByTestId('card-stranger-c').textContent).toBe('none')
    // The N+1 assertion: three mounted hooks, one network fetch.
    expect(edgesSelect).toHaveBeenCalledTimes(1)
    expect(edgesSelect).toHaveBeenCalledWith('profile_friend_edges')
  })

  it('invalidateFriendshipEdges() converges mounted cards on out-of-hook mutations', async () => {
    render(<Card profileId="friend-b" />)
    await waitFor(() => expect(screen.getByTestId('card-friend-b').textContent).toBe('requested'))

    // e.g. the other party accepted and OUR notifications-panel flow (or
    // FriendsTab / ConnectionsSection) wrote profile_friendships directly.
    edgeRows = [
      { friend_id: 'friend-b', status: 'accepted', requester_id: 'viewer-1', id: 'e2' },
    ]
    invalidateFriendshipEdges()

    await waitFor(() => expect(screen.getByTestId('card-friend-b').textContent).toBe('friend'))
    expect(edgesSelect).toHaveBeenCalledTimes(2)
  })
})
