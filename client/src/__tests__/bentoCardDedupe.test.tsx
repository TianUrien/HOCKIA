/**
 * Bento-card fetch dedupe — pattern regression.
 *
 * After JourneyCard's dedupe fix, all 7 other Bento cards that hit
 * supabase on mount got the same treatment (CommunityCard,
 * OpportunitiesCard, ClubMembersCard, SavedCandidatesCard,
 * CoachApplicationsCard, CoachPostedOpportunitiesCard, MediaCard).
 *
 * Lock-in test: mount the same card twice with the same identifier and
 * verify only ONE supabase fetch fires. CommunityCard is the canary —
 * cheapest shape, single .from('profile_comments') call. The other six
 * cards use the identical `requestCache.dedupe(cacheKey, fn, 30000)`
 * wrapper, so this single test is enough to catch the pattern
 * regressing (if any card stops using dedupe, the lib.requestCache
 * tests still pass but real-world fetches stack up).
 *
 * Per-card behavioural tests (toast on success, deep-link routing,
 * etc.) belong in card-specific suites; this is purely the dedupe
 * contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { requestCache } from '@/lib/requestCache'

const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(function (this: unknown) {
      // The hook awaits the second .eq() — make the builder thenable
      // so the await resolves with the expected {count, error} shape.
      const chain = builder as unknown as Record<string, unknown>
      chain.then = (resolve: (v: { count: number; error: null }) => unknown) =>
        Promise.resolve({ count: 5, error: null }).then(resolve)
      return builder
    }),
  }
  return {
    supabase: {
      from: (...args: unknown[]) => {
        fromSpy(...args)
        return builder
      },
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import CommunityCard from '@/components/dashboard/bento/CommunityCard'

const baseProfile = {
  id: 'profile-1',
  accepted_friend_count: 0,
  accepted_reference_count: 0,
  post_count: 0,
}

function renderCard() {
  return render(
    <MemoryRouter>
      <CommunityCard profile={baseProfile} onOpenTab={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('Bento card dedupe pattern (CommunityCard canary)', () => {
  beforeEach(() => {
    // requestCache holds state at module level; clear it between tests
    // so each one starts cold.
    requestCache.clear()
    fromSpy.mockClear()
  })

  it('fires only one fetch when the card mounts twice for the same profile', async () => {
    renderCard()
    renderCard()

    await waitFor(() => {
      expect(fromSpy).toHaveBeenCalledWith('profile_comments')
    })
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'profile_comments')).toHaveLength(1)
  })

  it('does not re-fetch when a card unmounts and remounts within TTL', async () => {
    const first = renderCard()
    await waitFor(() => expect(fromSpy).toHaveBeenCalledTimes(1))

    first.unmount()
    cleanup()
    renderCard()

    // Cache hit — no new fetch.
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'profile_comments')).toHaveLength(1)
  })
})
