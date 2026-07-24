import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConnectionsPreview from '@/components/profile/ConnectionsPreview'

// Covers the branches staging data couldn't exercise in QA (2026-07-23):
// the >MAX_FACES "See all N connections" truncation and the credential
// ranking. The reconciled-design fences (anon gate, zero-collapse) are
// asserted here too so the contract lives in one place.

const h = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: h.rpcMock },
}))

vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

/** The component reads BOTH the faces and the visible total from the one
 *  fenced RPC, so the stub returns rows carrying total_count (the RPC's
 *  single-probe pattern). */
function mockGraph(total: number, rows: Array<Record<string, unknown>>) {
  const withTotal = rows.map((r) => ({ ...r, total_count: total }))
  h.rpcMock.mockImplementation((fn: string) => {
    if (fn !== 'get_profile_connections') throw new Error(`unexpected rpc ${fn}`)
    return Promise.resolve({ data: withTotal, error: null })
  })
}

function profileRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `f${i}`,
    full_name: `Player ${i}`,
    avatar_url: null,
    role: 'player',
    username: `player${i}`,
    is_verified: false,
    base_location: null,
    current_club: null,
    connected_at: new Date(2026, 0, 28 - i).toISOString(),
    ...overrides,
  }
}

function renderPreview(props: Partial<Parameters<typeof ConnectionsPreview>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ConnectionsPreview
        profileId="club-1"
        profileFirstName="Marcia LaPlante"
        totalConnections={12}
        isAuthenticated
        onSeeAll={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('ConnectionsPreview', () => {
  it('caps the strip at 8 faces and shows "See all N connections" above MAX_FACES', async () => {
    mockGraph(12, Array.from({ length: 12 }, (_, i) => profileRow(i + 1)))
    const onSeeAll = vi.fn()
    renderPreview({ onSeeAll })

    const seeAll = await screen.findByRole('button', { name: /See all 12 connections/ })
    // Count pill fires at >= 10.
    expect(screen.getByText('12 connections')).toBeInTheDocument()
    // 8 face buttons (title = full name) + nothing more.
    expect(screen.getAllByTestId('avatar')).toHaveLength(8)

    fireEvent.click(seeAll)
    expect(onSeeAll).toHaveBeenCalledTimes(1)
  })

  it('ranks clubs/coaches and verified profiles ahead of players', async () => {
    mockGraph(12, [
      ...Array.from({ length: 10 }, (_, i) => profileRow(i + 1)),
      profileRow(11, { full_name: 'Club Alpha', role: 'club' }),
      profileRow(12, { full_name: 'Coach Beta', role: 'coach', is_verified: true }),
    ])
    renderPreview()

    await screen.findByRole('button', { name: /See all 12 connections/ })
    const faceButtons = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('title'))
    expect(faceButtons[0]).toHaveAttribute('title', 'Club Alpha')
    expect(faceButtons[1]).toHaveAttribute('title', 'Coach Beta')
  })

  it('hides the See all link and count pill for a small network', async () => {
    mockGraph(3, Array.from({ length: 3 }, (_, i) => profileRow(i + 1)))
    renderPreview({ totalConnections: 3 })

    expect(await screen.findAllByTestId('avatar')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /See all/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/3 connections/)).not.toBeInTheDocument()
  })

  it('anonymous: sign-in gate only, no graph fetch', () => {
    renderPreview({ isAuthenticated: false, signInVerb: 'connects with' })

    expect(
      screen.getByText(/Sign in to see who Marcia connects with\./),
    ).toBeInTheDocument()
    // Anonymous viewers never hit the graph — the RPC is signed-in only
    // (revoked from anon) and the design forbids public enumeration.
    expect(h.rpcMock).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('avatar')).toHaveLength(0)
  })

  it('shows the FENCED total, not the denormalized prop, once loaded', async () => {
    // The profile row claims 27; this viewer can only see 11 (blocked
    // pairs / hidden / test accounts). The pill and "See all" must quote
    // the number the connections page will actually list.
    mockGraph(11, Array.from({ length: 11 }, (_, i) => profileRow(i + 1)))
    renderPreview({ totalConnections: 27 })

    expect(
      await screen.findByRole('button', { name: /See all 11 connections/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('11 connections')).toBeInTheDocument()
    expect(screen.queryByText(/27 connections/)).not.toBeInTheDocument()
  })

  it('says so instead of rendering a hollow card when fences hide everyone', async () => {
    mockGraph(0, [])
    renderPreview({ totalConnections: 4 })

    expect(await screen.findByText('No connections to show.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('avatar')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /See all/ })).not.toBeInTheDocument()
  })

  it('collapses entirely at zero connections', () => {
    // NOTE: the graph fetch still fires (effect guards on auth, not count)
    // — collapse is a render-side rule, so only the DOM is asserted.
    mockGraph(0, [])
    const { container } = renderPreview({ totalConnections: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to the denormalized count if the RPC errors', async () => {
    h.rpcMock.mockResolvedValue({ data: null, error: new Error('boom') })
    renderPreview({ totalConnections: 12 })

    expect(await screen.findByText(/Couldn't load connections right now\./)).toBeInTheDocument()
    // Pill still renders from the prop rather than flashing a wrong 0.
    expect(screen.getByText('12 connections')).toBeInTheDocument()
  })
})
