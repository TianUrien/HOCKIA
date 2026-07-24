import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PublicConnectionsPage from '@/components/profile/PublicConnectionsPage'

// The dedicated visitor Connections screen (Phase 3). Its whole point is
// that the header count and the list come from the SAME fenced RPC, so
// they can never disagree — plus search / role filter / paging.

const h = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpcMock } }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
}))
vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role?: string | null }) => (role ? <span>{role}</span> : null),
}))

function row(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `c${i}`,
    full_name: `Connection ${i}`,
    avatar_url: null,
    role: 'player',
    username: `conn${i}`,
    is_verified: false,
    base_location: 'Madrid',
    current_club: null,
    connected_at: '2026-07-01T00:00:00Z',
    total_count: 0,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PublicConnectionsPage profileId="p1" profileName="Marcia LaPlante" />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('PublicConnectionsPage', () => {
  it('renders the list and a header count from the SAME rpc payload', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(i + 1, { total_count: 3 }))
    h.rpcMock.mockResolvedValue({ data: rows, error: null })
    renderPage()

    expect(await screen.findByText('Connection 1')).toBeInTheDocument()
    expect(screen.getByText('3 connections')).toBeInTheDocument()
    expect(screen.getAllByTestId('avatar')).toHaveLength(3)
  })

  it('paginates: "Show more" appends the next page at the right offset', async () => {
    const firstPage = Array.from({ length: 24 }, (_, i) => row(i + 1, { total_count: 30 }))
    const secondPage = Array.from({ length: 6 }, (_, i) => row(i + 25, { total_count: 30 }))
    h.rpcMock
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null })
    renderPage()

    const more = await screen.findByRole('button', { name: /Show more \(24 of 30\)/ })
    fireEvent.click(more)

    await waitFor(() => expect(screen.getByText('Connection 30')).toBeInTheDocument())
    // Page 1 rows are still mounted — appended, not replaced.
    expect(screen.getByText('Connection 1')).toBeInTheDocument()
    expect(h.rpcMock).toHaveBeenLastCalledWith(
      'get_profile_connections',
      expect.objectContaining({ p_offset: 24, p_limit: 24 }),
    )
    // Everything loaded → the button retires.
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })

  it('passes the debounced search term to the rpc and resets to offset 0', async () => {
    h.rpcMock.mockResolvedValue({ data: [row(1, { total_count: 1 })], error: null })
    renderPage()
    await screen.findByText('Connection 1')

    fireEvent.change(screen.getByLabelText(/Search connections/i), {
      target: { value: 'valen' },
    })

    await waitFor(() =>
      expect(h.rpcMock).toHaveBeenLastCalledWith(
        'get_profile_connections',
        expect.objectContaining({ p_search: 'valen', p_offset: 0 }),
      ),
    )
  })

  it('passes the role filter to the rpc', async () => {
    h.rpcMock.mockResolvedValue({ data: [row(1, { total_count: 1 })], error: null })
    renderPage()
    await screen.findByText('Connection 1')

    fireEvent.click(screen.getByRole('button', { name: 'Clubs' }))

    await waitFor(() =>
      expect(h.rpcMock).toHaveBeenLastCalledWith(
        'get_profile_connections',
        expect.objectContaining({ p_role: 'club', p_offset: 0 }),
      ),
    )
  })

  it('distinguishes a filtered no-match from an empty network', async () => {
    h.rpcMock.mockResolvedValue({ data: [], error: null })
    renderPage()

    expect(
      await screen.findByText('Marcia has no connections to show yet.'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Search connections/i), {
      target: { value: 'zzz' },
    })
    expect(
      await screen.findByText('No connections match your search.'),
    ).toBeInTheDocument()
  })

  it('renders an empty state (not a crash) when the rpc errors', async () => {
    h.rpcMock.mockResolvedValue({ data: null, error: new Error('42501') })
    renderPage()

    expect(
      await screen.findByText('Marcia has no connections to show yet.'),
    ).toBeInTheDocument()
  })
})
