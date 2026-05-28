/**
 * MoreActionsMenu — render + interaction contract.
 *
 * Locks in:
 *   - ⋯ button toggles the dropdown
 *   - "Move to list…" opens the MoveToShortlistMenu picker
 *   - "Add note in list" navigates to /dashboard/shortlists
 *   - Outside-click closes the dropdown
 *
 * MoveToShortlistMenu is stubbed (it has its own tests via useShortlists);
 * here we only care that MoreActionsMenu hands open=true to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// Inert supabase — MoveToAddMenu insert path only fires when the user
// picks a list, which our stub never triggers.
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  const chain = vi.fn(() => builder)
  builder.select = chain
  builder.eq = chain
  builder.insert = chain
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    },
  }
})

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ profile: { id: 'viewer-1', role: 'club' } }),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/lib/trackDbEvent', () => ({
  trackDbEvent: vi.fn(),
}))

vi.mock('@/lib/sentryHelpers', () => ({
  reportSupabaseError: vi.fn(),
  isAuthExpiredError: vi.fn(() => false),
}))

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

// Stub MoveToShortlistMenu — we only care that MoreActionsMenu opens it.
vi.mock('@/components/recruiting/MoveToShortlistMenu', () => ({
  default: ({ open, title }: { open: boolean; title?: string }) =>
    open ? <div data-testid="move-shortlist-menu" data-title={title} /> : null,
}))

import MoreActionsMenu from '@/components/recruiting/MoreActionsMenu'

const renderMenu = () =>
  render(
    <MemoryRouter>
      <MoreActionsMenu playerId="player-9" playerName="Jordan Hall" />
    </MemoryRouter>,
  )

describe('MoreActionsMenu', () => {
  beforeEach(() => {
    navigateMock.mockClear()
  })

  it('toggles the dropdown when the ⋯ button is clicked', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: /more actions/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /move to list/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /add note in list/i })).toBeInTheDocument()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens MoveToShortlistMenu when "Move to list…" is picked', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: /more actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /move to list/i }))

    // Dropdown closes when picker opens.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const picker = screen.getByTestId('move-shortlist-menu')
    expect(picker).toHaveAttribute('data-title', 'Add to list…')
  })

  it('navigates to /dashboard/shortlists when "Add note in list" is picked', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: /more actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /add note in list/i }))

    expect(navigateMock).toHaveBeenCalledWith('/dashboard/shortlists')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the dropdown on outside click', async () => {
    render(
      <MemoryRouter>
        <div>
          <button type="button">outside</button>
          <MoreActionsMenu playerId="player-9" playerName="Jordan Hall" />
        </div>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('enforces a single-open invariant — opening menu B closes menu A', async () => {
    // Regression test for F1: Community grid had both ⋯ menus open
    // simultaneously because the document-mousedown handler raced
    // React's onClick. Module-level activeMenuCloser singleton fixes it.
    render(
      <MemoryRouter>
        <div>
          <div data-testid="wrapper-a">
            <MoreActionsMenu playerId="player-A" playerName="Player A" />
          </div>
          <div data-testid="wrapper-b">
            <MoreActionsMenu playerId="player-B" playerName="Player B" />
          </div>
        </div>
      </MemoryRouter>,
    )

    const [triggerA, triggerB] = screen.getAllByRole('button', { name: /more actions/i })

    await userEvent.click(triggerA)
    expect(screen.getAllByRole('menu')).toHaveLength(1)

    await userEvent.click(triggerB)
    // Both clicks complete, but A must have closed first.
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(triggerA).toHaveAttribute('aria-expanded', 'false')
    expect(triggerB).toHaveAttribute('aria-expanded', 'true')
  })
})
