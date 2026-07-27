import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProtectedRoute from '@/components/ProtectedRoute'

/**
 * The three-way routing contract for a LOGGED-OUT visitor:
 *   public path     → renders
 *   protected path  → redirected to the landing page
 *   unknown path    → renders (falls through to the router's * NotFoundPage)
 *
 * The third case is the one that regressed silently before: unknown paths
 * were treated as protected, so every typo'd or dead link showed the landing
 * page with no feedback — a soft-404.
 */

const h = vi.hoisted(() => ({
  state: { user: null as null | object, profile: null as null | object, loading: false },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))

/** ProtectedRoute redirects with <Navigate to="/">, and in this harness the
 *  SAME children then re-render at '/' (a public path) — so "children
 *  rendered?" cannot distinguish allowed from redirected. The location can:
 *  a redirect lands on '/', a fallthrough stays on the original path. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <ProtectedRoute>
        <div data-testid="content">page content</div>
      </ProtectedRoute>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute — logged out', () => {
  it('renders public routes in place', () => {
    mount('/opportunities')
    expect(screen.getByTestId('loc')).toHaveTextContent('/opportunities')
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('redirects protected routes to the landing page', () => {
    mount('/dashboard/profile')
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/)
  })

  it('redirects /home — protected even though it is the app shell', () => {
    mount('/home')
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/)
  })

  it('lets UNKNOWN paths through so the * route can 404 — no soft-404', () => {
    mount('/zzz-not-a-route')
    expect(screen.getByTestId('loc')).toHaveTextContent('/zzz-not-a-route')
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('prefix collision does not widen the gate: /settings redirects, /settings-typo 404s in place', () => {
    mount('/settings')
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/)
  })

  it('/settings-typo is unknown, not protected', () => {
    mount('/settings-typo')
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings-typo')
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })
})
