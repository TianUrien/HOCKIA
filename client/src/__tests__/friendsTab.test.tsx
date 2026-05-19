import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import FriendsTab from '@/components/FriendsTab'

const user = userEvent.setup()

const toastMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => toastMocks,
}))

type EdgeRow = {
  id: string
  profile_id: string
  friend_id: string
  requester_id: string
  status: string
  accepted_at: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  full_name: string
  username: string
  avatar_url: string | null
  role: string
  base_location: string
  current_club: string
}

const baseEdge: EdgeRow = {
  id: 'edge-1',
  profile_id: 'user-1',
  friend_id: 'friend-1',
  requester_id: 'friend-1',
  status: 'pending',
  accepted_at: null,
  created_at: '2024-01-01T00:00:00Z',
}

const baseProfile: ProfileRow = {
  id: 'friend-1',
  full_name: 'Jamie Lee',
  username: 'jamie',
  avatar_url: null,
  role: 'player',
  base_location: 'Paris',
  current_club: 'HC Paris',
}

const authState = {
  profile: { id: 'user-1' },
}

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

const trustedReferencesCalls: Array<{ profileId: string; friendOptions: unknown[] }> = []
vi.mock('@/components/TrustedReferencesSection', () => ({
  default: ({ profileId, friendOptions }: { profileId: string; friendOptions: unknown[] }) => {
    trustedReferencesCalls.push({ profileId, friendOptions })
    return <div data-testid="trusted-references" />
  },
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => <span>{initials}</span>,
}))

vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role?: string | null }) => <span>{role}</span>,
}))

const supabaseState = vi.hoisted(() => ({
  edgesResult: { data: [] as EdgeRow[], error: null as null | Error },
  profilesResult: { data: [] as ProfileRow[], error: null as null | Error },
  updateResult: { error: null as null | Error },
  updateSpy: vi.fn(),
  updateEqSpy: vi.fn(),
  lastUpdatePayload: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase', () => {
  const buildEdgesQuery = () => {
    let orderCalls = 0
    const query: Record<string, (...args: unknown[]) => unknown> = {}
    query.select = () => query
    query.eq = () => query
    query.neq = () => query
    query.order = () => {
      orderCalls += 1
      if (orderCalls >= 2) {
        return Promise.resolve(supabaseState.edgesResult)
      }
      return query
    }
    return query
  }

  const buildProfilesQuery = () => {
    const query: Record<string, (...args: unknown[]) => unknown> = {}
    query.select = () => query
    query.in = () => Promise.resolve(supabaseState.profilesResult)
    return query
  }

  const buildFriendshipsQuery = () => {
    const eq = vi.fn(() => Promise.resolve(supabaseState.updateResult))
    supabaseState.updateEqSpy = eq
    const update = vi.fn((payload: Record<string, unknown>) => {
      supabaseState.lastUpdatePayload = payload
      return { eq }
    })
    supabaseState.updateSpy = update
    return { update }
  }

  const from = (table: string) => {
    if (table === 'profile_friend_edges') return buildEdgesQuery()
    if (table === 'profiles') return buildProfilesQuery()
    if (table === 'profile_friendships') return buildFriendshipsQuery()
    return buildProfilesQuery()
  }

  return {
    supabase: { from },
  }
})

const renderFriendsTab = (props: Partial<React.ComponentProps<typeof FriendsTab>> = {}) => {
  return render(
    <MemoryRouter>
      <FriendsTab profileId="user-1" {...props} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  trustedReferencesCalls.length = 0
  supabaseState.edgesResult = { data: [], error: null }
  supabaseState.profilesResult = { data: [], error: null }
  supabaseState.updateResult = { error: null }
  supabaseState.lastUpdatePayload = null
})

describe('FriendsTab', () => {
  it('shows incoming requests and accepts them', async () => {
    supabaseState.edgesResult = {
      data: [
        { ...baseEdge },
      ],
      error: null,
    }
    supabaseState.profilesResult = {
      data: [baseProfile],
      error: null,
    }

    renderFriendsTab()

    expect(await screen.findByText('Jamie Lee')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() => {
      expect(supabaseState.lastUpdatePayload).toEqual({ status: 'accepted' })
      expect(supabaseState.updateEqSpy).toHaveBeenCalledWith('id', 'edge-1')
      expect(toastMocks.addToast).toHaveBeenCalledWith('Connection request accepted.', 'success')
    })
  })

  it('renders accepted connections and forwards them to trusted references', async () => {
    supabaseState.edgesResult = {
      data: [
        { ...baseEdge, id: 'edge-accepted', status: 'accepted', requester_id: 'user-1', accepted_at: '2024-02-01T00:00:00Z' },
      ],
      error: null,
    }
    supabaseState.profilesResult = {
      data: [baseProfile],
      error: null,
    }

    renderFriendsTab()

    expect(await screen.findByText(/Connected/i)).toBeInTheDocument()
    expect(screen.getByText('1 connection')).toBeInTheDocument()
    await waitFor(() => {
      expect(trustedReferencesCalls.at(-1)).toEqual(
        expect.objectContaining({ profileId: 'user-1', friendOptions: expect.arrayContaining([expect.objectContaining({ id: 'friend-1' })]) })
      )
    })
  })

  // ── Profile link routing — role-aware (regression guard) ─────────
  // Pre-fix bug: every non-club/umpire/brand role routed to /players/<slug>,
  // so coach friends incorrectly opened the player URL prefix instead of
  // their own /coaches/<slug>.

  const renderWithFriend = (role: string, override: Partial<ProfileRow> = {}) => {
    supabaseState.edgesResult = {
      data: [
        { ...baseEdge, id: 'edge-x', status: 'accepted', requester_id: 'user-1', accepted_at: '2024-02-01T00:00:00Z' },
      ],
      error: null,
    }
    supabaseState.profilesResult = {
      data: [{ ...baseProfile, role, ...override }],
      error: null,
    }
    renderFriendsTab()
  }

  const expectLinkToHaveHref = async (linkText: string | RegExp, hrefPattern: string | RegExp) => {
    const link = (await screen.findAllByRole('link'))[0]
    expect(link).toBeTruthy()
    const href = link.getAttribute('href')
    expect(href).toBeTruthy()
    if (typeof hrefPattern === 'string') {
      expect(href).toBe(hrefPattern)
    } else {
      expect(href).toMatch(hrefPattern)
    }
    void linkText
  }

  it('player friend link routes to /players/:username', async () => {
    renderWithFriend('player', { username: 'alex-p' })
    await expectLinkToHaveHref('Jamie Lee', '/players/alex-p')
  })

  it('coach friend link routes to /coaches/:username (regression: was /players/)', async () => {
    renderWithFriend('coach', { username: 'maria-c' })
    await expectLinkToHaveHref('Jamie Lee', '/coaches/maria-c')
  })

  it('umpire friend link routes to /umpires/:username', async () => {
    renderWithFriend('umpire', { username: 'sara-u' })
    await expectLinkToHaveHref('Jamie Lee', '/umpires/sara-u')
  })

  it('club friend link routes to /clubs/:username', async () => {
    renderWithFriend('club', { username: 'hc-rotterdam' })
    await expectLinkToHaveHref('Jamie Lee', '/clubs/hc-rotterdam')
  })

  it('brand friend link uses /brands/id/:id (slug-redirect path)', async () => {
    renderWithFriend('brand', { username: 'wont-be-used' })
    // brands key on brand.slug, not profiles.username, so we always
    // route through the id-redirect.
    await expectLinkToHaveHref('Jamie Lee', '/brands/id/friend-1')
  })

  it('falls back to /<role>/id/<uuid> when username is missing — coach', async () => {
    renderWithFriend('coach', { username: '' as unknown as string })
    await expectLinkToHaveHref('Jamie Lee', '/coaches/id/friend-1')
  })

  it('falls back to /players/id/<uuid> when username is missing — player', async () => {
    renderWithFriend('player', { username: '' as unknown as string })
    await expectLinkToHaveHref('Jamie Lee', '/players/id/friend-1')
  })

  // ── Empty / loading / role-gate states ───────────────────────────

  it('shows empty state when no connections and user is owner', async () => {
    supabaseState.edgesResult = { data: [], error: null }
    renderFriendsTab()
    expect(await screen.findByText(/No connections yet/i)).toBeInTheDocument()
    // Owner gets a "Find people" CTA (renamed from "Find friends" in the
    // May 2026 Community redesign microcopy refresh).
    expect(screen.getByRole('button', { name: /Find people/i })).toBeInTheDocument()
  })

  it('shows skeleton placeholders before fetch resolves', async () => {
    supabaseState.edgesResult = { data: [], error: null }
    const { container } = renderFriendsTab()
    // Synchronous: the loading=true initial state renders 3 pulse skeletons.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // Then wait for the empty state so the test doesn't leave pending state
    // updates and trip act() warnings under React strict-mode tests.
    expect(await screen.findByText(/No connections yet/i)).toBeInTheDocument()
  })

  it('renders Requests section with deep-link anchor when isOwner', async () => {
    supabaseState.edgesResult = { data: [], error: null }
    const { container } = renderFriendsTab()
    // Wait for fetch to settle (data is empty so component renders the
    // "no new requests" state under the anchor). "Incoming Requests"
    // heading was renamed to "Requests" in the Community redesign.
    await screen.findByText('Requests')
    const anchor = container.querySelector('[data-deeplink-section="incoming-requests"]')
    expect(anchor).not.toBeNull()
  })
})
