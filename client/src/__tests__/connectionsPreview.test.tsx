import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConnectionsPreview from '@/components/profile/ConnectionsPreview'

// Covers the branches staging data couldn't exercise in QA (2026-07-23):
// the >MAX_FACES "See all N connections" truncation and the credential
// ranking. The reconciled-design fences (anon gate, zero-collapse) are
// asserted here too so the contract lives in one place.

const h = vi.hoisted(() => ({
  fromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: h.fromMock },
}))

vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

/** Awaitable chain stub: every builder method returns the chain; awaiting
 *  it resolves to `result` (same shape the supabase-js builder thenable has). */
function chainResolving(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) {
    c[m] = vi.fn(() => c)
  }
  c.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  return c
}

function mockGraph(edgeCount: number, profiles: Array<Record<string, unknown>>) {
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    friend_id: `f${i + 1}`,
    status: 'accepted',
    created_at: new Date(2026, 0, edgeCount - i).toISOString(),
  }))
  h.fromMock.mockImplementation((table: string) => {
    if (table === 'profile_friend_edges') return chainResolving({ data: edges, error: null })
    if (table === 'profiles') return chainResolving({ data: profiles, error: null })
    throw new Error(`unexpected table ${table}`)
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
    expect(h.fromMock).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('avatar')).toHaveLength(0)
  })

  it('collapses entirely at zero connections', () => {
    // NOTE: the graph fetch still fires (effect guards on auth, not count)
    // — collapse is a render-side rule, so only the DOM is asserted.
    mockGraph(0, [])
    const { container } = renderPreview({ totalConnections: 0 })
    expect(container).toBeEmptyDOMElement()
  })
})
