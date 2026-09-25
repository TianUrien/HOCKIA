/**
 * QuickActionsRow — gate + action contract.
 *
 * Locks in:
 *   - Returns null for anonymous viewers
 *   - Returns null when viewer is the profile's own user
 *   - Save + ⋯ (shortlist actions) are recruiter-only: clubs and coaches
 *     who recruit for a team (founder rule 2026-09-25). Players and
 *     candidate coaches get Message + Add friend only.
 *   - Never renders the removed Invite/Compare placeholders (any role)
 *   - Save click delegates to useIsProfileSaved.toggle
 *   - Message click uses onMessage override when provided
 *   - Message click falls back to navigate('/messages?new=<id>') otherwise
 *
 * MoreActionsMenu is stubbed — its own tests cover the overflow flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// Inert supabase — not exercised on the gated/render paths covered here.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

// Per-test mutable auth state — set viewer role + id from the helper below.
const authState: { profile: { id: string; role: string; coach_recruits_for_team?: boolean } | null } = { profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}))

// useIsProfileSaved — per-test mutable so we can flip auth + saved.
const savedState = {
  isSaved: false,
  mutating: false,
  isAuthenticated: true,
  isOwnProfile: false,
  toggle: vi.fn(() => Promise.resolve()),
}
vi.mock('@/hooks/useSavedProfiles', () => ({
  useIsProfileSaved: () => savedState,
}))

// useFriendship — mocked for AddFriendAction since it's now shown by default
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({
    loading: false,
    mutating: false,
    isAuthenticated: true,
    isOwnProfile: false,
    isFriend: false,
    isOutgoingRequest: false,
    sendRequest: vi.fn(),
  }),
}))

vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))

// Stub MoreActionsMenu so we can assert it's mounted without pulling
// in the overflow + MoveToShortlistMenu tree.
vi.mock('@/components/recruiting/MoreActionsMenu', () => ({
  default: ({ playerId }: { playerId: string }) => (
    <div data-testid="more-actions-menu" data-player-id={playerId} />
  ),
}))

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import QuickActionsRow from '@/components/recruiting/QuickActionsRow'

function setViewer(opts: { role: string | null; recruits?: boolean; isAuthenticated?: boolean; isOwnProfile?: boolean; isSaved?: boolean }) {
  authState.profile = opts.role ? { id: 'viewer-1', role: opts.role, coach_recruits_for_team: opts.recruits ?? false } : null
  savedState.isAuthenticated = opts.isAuthenticated ?? Boolean(opts.role)
  savedState.isOwnProfile = opts.isOwnProfile ?? false
  savedState.isSaved = opts.isSaved ?? false
  savedState.mutating = false
}

const renderRow = (props: Partial<React.ComponentProps<typeof QuickActionsRow>> = {}) =>
  render(
    <MemoryRouter>
      <QuickActionsRow playerId="player-9" playerName="Jordan Hall" {...props} />
    </MemoryRouter>,
  )

describe('QuickActionsRow', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    savedState.toggle.mockClear()
  })

  it('renders nothing for an anonymous viewer', () => {
    setViewer({ role: null, isAuthenticated: false })
    const { container } = renderRow()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when viewer is the profile owner', () => {
    setViewer({ role: 'player', isOwnProfile: true })
    const { container } = renderRow()
    expect(container.firstChild).toBeNull()
  })

  it('a player viewer gets Message + Add friend but never Save or the ⋯ menu', () => {
    setViewer({ role: 'player' })
    renderRow({ showMoreMenu: true })
    expect(screen.queryByRole('button', { name: /save jordan hall/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /message jordan hall/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add jordan hall as a friend/i })).toBeInTheDocument()
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument()
  })

  it('a player viewer never sees "Saved" even for a legacy saved row', () => {
    setViewer({ role: 'player', isSaved: true })
    renderRow()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('a coach who is not recruiting gets no Save', () => {
    setViewer({ role: 'coach', recruits: false })
    renderRow({ showMoreMenu: true })
    expect(screen.queryByRole('button', { name: /save jordan hall/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument()
  })

  it('a recruiting coach gets Save and the ⋯ menu when enabled', () => {
    setViewer({ role: 'coach', recruits: true })
    renderRow({ showMoreMenu: true })
    expect(screen.getByRole('button', { name: /save jordan hall/i })).toBeInTheDocument()
    expect(screen.getByTestId('more-actions-menu')).toBeInTheDocument()
  })

  it('never renders the removed Invite/Compare placeholders for non-recruiters', () => {
    setViewer({ role: 'player' })
    renderRow()
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument()
  })

  it('never renders Invite/Compare for recruiter (club/coach) viewers either', () => {
    setViewer({ role: 'club' })
    const { unmount } = renderRow()
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument()
    // Renders Save + Message + Add friend by default, no More menu
    expect(screen.getByRole('button', { name: /save jordan hall/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /message jordan hall/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add jordan hall as a friend/i })).toBeInTheDocument()
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument()
    unmount()

    setViewer({ role: 'coach' })
    renderRow()
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument()
  })

  it('renders "Saved" label + active state when already saved', () => {
    setViewer({ role: 'club', isSaved: true })
    renderRow()
    expect(screen.getByRole('button', { name: /remove jordan hall from saved/i })).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('invokes useIsProfileSaved.toggle when Save is clicked', async () => {
    setViewer({ role: 'club' })
    renderRow()
    await userEvent.click(screen.getByRole('button', { name: /save jordan hall/i }))
    expect(savedState.toggle).toHaveBeenCalledTimes(1)
  })

  it('uses onMessage override when provided', async () => {
    setViewer({ role: 'club' })
    const onMessage = vi.fn()
    renderRow({ onMessage })
    await userEvent.click(screen.getByRole('button', { name: /message jordan hall/i }))
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('navigates to /messages?new=<id> when no onMessage override is provided', async () => {
    setViewer({ role: 'club' })
    renderRow()
    await userEvent.click(screen.getByRole('button', { name: /message jordan hall/i }))
    // Second arg carries returnTo state for context-aware back nav
    // — defaults to '/' since MemoryRouter starts at root path. messageOrigin
    // defaults to 'Community' (this row's primary host is community discovery).
    expect(navigateMock).toHaveBeenCalledWith(
      '/messages?new=player-9',
      { state: { returnTo: '/', messageOrigin: 'Community' } },
    )
  })
})
