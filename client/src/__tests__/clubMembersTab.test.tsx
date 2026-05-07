import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ClubMembersTab from '@/components/ClubMembersTab'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

const user = userEvent.setup()

// ── Hoisted mocks ──────────────────────────────────────────────────

const toastMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}))

const authState = vi.hoisted(() => ({
  profile: { id: 'club-1', role: 'club', is_test_account: false } as { id: string; role: string; is_test_account: boolean },
  user: { id: 'club-1' },
}))

const sentryMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
}))

const rpcMock = vi.hoisted(() => vi.fn())

// ── Module mocks ───────────────────────────────────────────────────

vi.mock('@/lib/toast', () => ({
  useToastStore: () => toastMocks,
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sentry/react', () => ({
  addBreadcrumb: sentryMocks.addBreadcrumb,
  captureException: vi.fn(),
}))

vi.mock('@/lib/sentryHelpers', () => ({
  reportSupabaseError: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

// Mock Avatar and RoleBadge (imported via barrel)
vi.mock('@/components', () => ({
  Avatar: ({ alt }: { alt: string }) => <div data-testid="avatar" aria-label={alt} />,
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}))

// ── Helpers ────────────────────────────────────────────────────────

function makeMember(overrides: Partial<{
  id: string
  full_name: string
  role: string
  position: string | null
  base_location: string | null
  is_test_account: boolean
  total_count: number
}> = {}) {
  return {
    id: overrides.id ?? 'member-1',
    full_name: overrides.full_name ?? 'Alice Player',
    avatar_url: null,
    role: overrides.role ?? 'player',
    nationality: 'English',
    nationality_country_id: 1,
    nationality2_country_id: null,
    base_location: overrides.base_location ?? 'London',
    position: overrides.position ?? 'Midfielder',
    secondary_position: null,
    current_club: 'Test FC',
    current_world_club_id: 'wc-1',
    created_at: '2026-01-01T00:00:00Z',
    open_to_play: true,
    open_to_coach: false,
    is_test_account: overrides.is_test_account ?? false,
    total_count: overrides.total_count ?? 1,
  }
}

function renderTab(profileId = 'club-1') {
  return render(
    <MemoryRouter>
      <ClubMembersTab profileId={profileId} />
    </MemoryRouter>
  )
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  authState.profile = { id: 'club-1', role: 'club', is_test_account: false }
  authState.user = { id: 'club-1' }
})

describe('ClubMembersTab', () => {
  // ── Loading state ────────────────────────────────────────────────

  it('shows skeleton loading state initially', () => {
    rpcMock.mockReturnValue(new Promise(() => {})) // never resolves

    renderTab()
    // 6 skeleton rows (pulse divs)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(6)
  })

  // ── Successful fetch ─────────────────────────────────────────────

  it('renders member rows on successful fetch', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeMember({ id: 'm-1', full_name: 'Alice Player', total_count: 2 }),
        makeMember({ id: 'm-2', full_name: 'Bob Coach', role: 'coach', total_count: 2 }),
      ],
      error: null,
    })

    renderTab()

    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(2)
    })
    expect(screen.getByText('Alice Player')).toBeInTheDocument()
    expect(screen.getByText('Bob Coach')).toBeInTheDocument()
  })

  it('shows position and location in secondary line', async () => {
    rpcMock.mockResolvedValue({
      data: [makeMember({ position: 'midfielder', base_location: 'London, UK' })],
      error: null,
    })

    renderTab()

    await waitFor(() => {
      expect(screen.getByTestId('member-row')).toBeInTheDocument()
    })
    expect(screen.getByText('Midfielder · London, UK')).toBeInTheDocument()
  })

  it('calls RPC with correct parameters', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    renderTab('club-xyz')

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('get_club_members', {
        p_profile_id: 'club-xyz',
        p_limit: 30,
        p_offset: 0,
      })
    })
  })

  // ── Empty state ──────────────────────────────────────────────────

  it('shows empty state when no members returned', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    renderTab()

    expect(await screen.findByText('No members yet')).toBeInTheDocument()
    expect(screen.getByText(/Players and coaches who assign this club/)).toBeInTheDocument()
  })

  // ── Error handling ───────────────────────────────────────────────

  it('shows error UI and reports to Sentry on fetch failure', async () => {
    const { reportSupabaseError } = await import('@/lib/sentryHelpers')
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "world_clubs" does not exist', code: '42P01' },
    })

    renderTab()

    // Error UI appears
    expect(await screen.findByText('Failed to load members. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()

    // Sentry was called
    expect(reportSupabaseError).toHaveBeenCalledWith(
      'club_members.fetch',
      expect.objectContaining({ message: 'relation "world_clubs" does not exist' }),
      expect.objectContaining({ profileId: 'club-1' }),
      expect.objectContaining({ feature: 'club_members' }),
    )
  })

  it('retry button re-fetches after error', async () => {
    // First call: error
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    })

    renderTab()

    expect(await screen.findByText('Failed to load members. Please try again.')).toBeInTheDocument()

    // Fix the RPC result for retry
    rpcMock.mockResolvedValueOnce({
      data: [makeMember({ full_name: 'Recovered Player' })],
      error: null,
    })

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.getByText('Recovered Player')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to load members')).not.toBeInTheDocument()
  })

  // ── Test account filtering ───────────────────────────────────────

  it('filters out test accounts for non-test users', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeMember({ id: 'real-1', full_name: 'Real Player', is_test_account: false, total_count: 2 }),
        makeMember({ id: 'test-1', full_name: 'Test Bot', is_test_account: true, total_count: 2 }),
      ],
      error: null,
    })

    renderTab()

    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(1)
    })
    expect(screen.getByText('Real Player')).toBeInTheDocument()
    expect(screen.queryByText('Test Bot')).not.toBeInTheDocument()
  })

  it('shows test accounts when current user is a test account', async () => {
    authState.profile = { id: 'club-1', role: 'club', is_test_account: true }

    rpcMock.mockResolvedValue({
      data: [
        makeMember({ id: 'real-1', full_name: 'Real Player', is_test_account: false, total_count: 2 }),
        makeMember({ id: 'test-1', full_name: 'Test Bot', is_test_account: true, total_count: 2 }),
      ],
      error: null,
    })

    renderTab()

    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(2)
    })
    expect(screen.getByText('Real Player')).toBeInTheDocument()
    expect(screen.getByText('Test Bot')).toBeInTheDocument()
  })

  it('shows empty state when all members are test accounts and user is not test', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeMember({ id: 'test-1', full_name: 'Test Bot', is_test_account: true, total_count: 1 }),
      ],
      error: null,
    })

    renderTab()

    expect(await screen.findByText('No members yet')).toBeInTheDocument()
  })

  // ── Pagination / Load More ───────────────────────────────────────

  it('shows Load More button when total_count > loaded members', async () => {
    rpcMock.mockResolvedValue({
      data: [makeMember({ id: 'm-1', total_count: 50 })],
      error: null,
    })

    renderTab()

    expect(await screen.findByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  it('does not show Load More when all members are loaded', async () => {
    rpcMock.mockResolvedValue({
      data: [makeMember({ id: 'm-1', total_count: 1 })],
      error: null,
    })

    renderTab()

    await waitFor(() => {
      expect(screen.getByTestId('member-row')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('shows toast on Load More failure', async () => {
    // Initial load succeeds
    rpcMock.mockResolvedValueOnce({
      data: [makeMember({ id: 'm-1', total_count: 50 })],
      error: null,
    })

    renderTab()

    const loadMoreBtn = await screen.findByRole('button', { name: /load more/i })

    // Next fetch fails
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    })

    await user.click(loadMoreBtn)

    await waitFor(() => {
      expect(toastMocks.addToast).toHaveBeenCalledWith(
        'Failed to load more members. Please try again.',
        'error'
      )
    })

    // Original member still displayed
    expect(screen.getByTestId('member-row')).toBeInTheDocument()
  })

  // ── Sentry breadcrumb ────────────────────────────────────────────

  it('adds Sentry breadcrumb before each fetch', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })

    renderTab('club-abc')

    await waitFor(() => {
      expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'supabase',
          message: 'club_members.fetch',
          data: expect.objectContaining({ profileId: 'club-abc' }),
        })
      )
    })
  })

  // ── Role-aware profile routing (regression for coach members) ────
  // Pre-fix bug: every member row routed to /players/id/<uuid>, so a
  // coach member of a club opened the player URL prefix. Fixed to use
  // /coaches/id/<uuid> when role==='coach'.

  it('player member click routes to /players/id/<uuid>', async () => {
    rpcMock.mockResolvedValue({
      data: [makeMember({ id: 'player-x', role: 'player' })],
      error: null,
    })

    renderTab()
    const row = await screen.findByTestId('member-row')
    await user.click(row)

    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/players\/id\/player-x\?ref=club-members$/),
    )
  })

  it('coach member click routes to /coaches/id/<uuid> (not /players/)', async () => {
    rpcMock.mockResolvedValue({
      data: [makeMember({ id: 'coach-y', role: 'coach' })],
      error: null,
    })

    renderTab()
    const row = await screen.findByTestId('member-row')
    await user.click(row)

    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/coaches\/id\/coach-y\?ref=club-members$/),
    )
    // Defensive: the url must NOT contain the legacy /players/ prefix
    const lastCall = navigateMock.mock.calls.at(-1)?.[0]
    expect(lastCall).not.toContain('/players/')
  })
})
