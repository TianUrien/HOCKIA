/**
 * Release audit 2026-10-05 · the auth gate against the REAL route table.
 *
 * ProtectedRoute decides by two hand-kept prefix lists (PUBLIC_ROUTES and
 * PROTECTED_ROUTE_PREFIXES, "keep in step with the route table in App.tsx").
 * The existing tests probe a handful of sample paths; nothing checked the two
 * lists against the routes that actually exist. This file reads every
 * `<Route path="/…">` out of App.tsx and drives ProtectedRoute with each one.
 *
 * Also covers AdminGuard, which had no test at all.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    user: null as null | { id: string },
    profile: null as null | { id: string; role: string; onboarding_completed: boolean },
    loading: false,
  },
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => h.rpc(...args) },
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
}))

import ProtectedRoute from '@/components/ProtectedRoute'
import { AdminGuard } from '@/features/admin/components/AdminGuard'

// ── The route table, read from App.tsx ──────────────────────────────────────

const APP_SOURCE = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')

/** Every absolute route pattern declared in App.tsx ("/inbox/:segment", …). */
const APP_ROUTES = [...new Set([...APP_SOURCE.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map((m) => m[1]))]

/** A concrete URL for a pattern: "/inbox/:segment" → "/inbox/x". */
const sample = (pattern: string) => pattern.replace(/:[A-Za-z]+/g, 'x')

/**
 * Pages a signed-out visitor is MEANT to see (ProtectedRoute's own doc
 * comment: landing, auth, legal, public directories and public profiles).
 * Written out here on purpose, independently of the component's list, so a
 * route that falls through the component's lists by accident shows up.
 */
const MEANT_TO_BE_PUBLIC = [
  '/', '/signup', '/signin', '/auth/callback', '/verify-email', '/forgot-password', '/reset-password',
  '/privacy-policy', '/terms', '/developers', '/offline',
  '/world', '/post', '/marketplace', '/brands', '/investors', '/invite', '/email-action', '/juniors-waitlist',
  '/community', '/opportunities',
  '/members', '/players', '/coaches', '/clubs', '/umpires',
]
/** Personal pages that happen to live under a public prefix. */
const PERSONAL_UNDER_PUBLIC = ['/opportunities/applications']
const meantPublic = (pattern: string) =>
  !PERSONAL_UNDER_PUBLIC.some((p) => pattern === p || pattern.startsWith(`${p}/`)) &&
  MEANT_TO_BE_PUBLIC.some((p) => (p === '/' ? pattern === '/' : pattern === p || pattern.startsWith(`${p}/`)))

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

/** Where a visitor ends up after opening `path` through ProtectedRoute. */
function landingPathFor(path: string): string {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <ProtectedRoute>
        <div data-testid="content">page</div>
      </ProtectedRoute>
    </MemoryRouter>,
  )
  const landed = view.getByTestId('loc').textContent ?? ''
  view.unmount()
  return landed
}

beforeEach(() => {
  h.state.user = null
  h.state.profile = null
  h.state.loading = false
  h.rpc.mockReset()
  sessionStorage.clear()
})

describe('the route table is readable', () => {
  it('finds the app routes (guards the parser itself)', () => {
    expect(APP_ROUTES.length).toBeGreaterThan(60)
    for (const must of ['/', '/home', '/inbox', '/messages/:conversationId', '/dashboard/profile', '/admin', '/applications/:applicationId/signing']) {
      expect(APP_ROUTES, must).toContain(must)
    }
  })
})

describe('signed-out visitor × every route in App.tsx', () => {
  it('every page meant to be public renders in place', () => {
    for (const pattern of APP_ROUTES.filter(meantPublic)) {
      expect(landingPathFor(sample(pattern)), pattern).toBe(sample(pattern))
    }
  })

  it('every member-only page redirects to the landing page and remembers the path', () => {
    const memberOnly = APP_ROUTES.filter((p) => !meantPublic(p))
    expect(memberOnly.length).toBeGreaterThan(20)
    for (const pattern of memberOnly) {
      sessionStorage.clear()
      expect(landingPathFor(sample(pattern)), pattern).toBe('/')
      expect(sessionStorage.getItem('hockia-redirect-after-login'), pattern).toBe(sample(pattern))
    }
  })

  // Release audit 2026-10-05 (MEDIUM, fixed): /pulse, /inbox, /inbox/:segment
  // and /applications/:applicationId/signing were in neither PUBLIC_ROUTES
  // nor PROTECTED_ROUTE_PREFIXES, so the gate treated them as "unknown URL →
  // let the router 404" and rendered the page for a signed-out visitor.
  it('no member-only page renders for a signed-out visitor', () => {
    const unguarded = APP_ROUTES.filter((p) => !meantPublic(p)).filter((p) => landingPathFor(sample(p)) !== '/')
    expect(unguarded).toEqual([])
  })

  it('the once-unguarded routes are now sent to sign in with the path remembered', () => {
    for (const path of ['/pulse', '/inbox', '/inbox/x', '/applications/x/signing']) {
      sessionStorage.clear()
      expect(landingPathFor(path), path).toBe('/')
      expect(sessionStorage.getItem('hockia-redirect-after-login'), path).toBe(path)
    }
  })

  // Same audit (LOW, fixed): "My applications" lives under the public
  // /opportunities prefix, so the prefix match alone treated it as public.
  it('/opportunities/applications (a personal page) asks a signed-out visitor to sign in', () => {
    expect(landingPathFor('/opportunities/applications')).toBe('/')
    expect(sessionStorage.getItem('hockia-redirect-after-login')).toBe('/opportunities/applications')
  })

  it('the public /opportunities listings around it stay public', () => {
    for (const path of ['/opportunities', '/opportunities/x', '/opportunities/applications-look-alike']) {
      expect(landingPathFor(path), path).toBe(path)
    }
  })
})

describe('signed in but onboarding not finished × every route in App.tsx', () => {
  const EXEMPT = ['/complete-profile', '/brands/onboarding', '/auth/callback', '/verify-email', '/terms', '/privacy-policy', '/offline', '/email-action', '/juniors-waitlist']
  const exempt = (pattern: string) => EXEMPT.some((p) => pattern === p || pattern.startsWith(`${p}/`))

  beforeEach(() => {
    h.state.user = { id: 'u1' }
    h.state.profile = { id: 'u1', role: 'player', onboarding_completed: false }
  })

  it('every non-exempt page, public ones included, sends them back to onboarding (the 18+ step cannot be skipped by URL)', () => {
    const gated = APP_ROUTES.filter((p) => !exempt(p))
    expect(gated.length).toBeGreaterThan(60)
    for (const pattern of gated) {
      expect(landingPathFor(sample(pattern)), pattern).toBe('/complete-profile')
    }
  })

  it('onboarding, the brand onboarding, auth plumbing and legal pages stay reachable', () => {
    for (const pattern of APP_ROUTES.filter(exempt)) {
      expect(landingPathFor(sample(pattern)), pattern).toBe(sample(pattern))
    }
  })

  it('a prefix look-alike is not exempt: /terms-of-anything is gated', () => {
    expect(landingPathFor('/terms-of-anything')).toBe('/complete-profile')
  })
})

describe('signed in and onboarded × every route in App.tsx', () => {
  it('nothing is redirected by the auth gate', () => {
    h.state.user = { id: 'u1' }
    h.state.profile = { id: 'u1', role: 'club', onboarding_completed: true }
    for (const pattern of APP_ROUTES) {
      expect(landingPathFor(sample(pattern)), pattern).toBe(sample(pattern))
    }
  })

  it('while the session is still loading, no page content renders for any route', () => {
    h.state.loading = true
    for (const pattern of ['/home', '/admin', '/messages/x', '/opportunities']) {
      const view = render(
        <MemoryRouter initialEntries={[pattern]}>
          <ProtectedRoute>
            <div data-testid="content">page</div>
          </ProtectedRoute>
        </MemoryRouter>,
      )
      expect(view.queryByTestId('content'), pattern).not.toBeInTheDocument()
      view.unmount()
    }
  })
})

// ── AdminGuard ──────────────────────────────────────────────────────────────

function mountAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin/overview']}>
      <Routes>
        <Route path="/" element={<div data-testid="landing">landing</div>} />
        <Route
          path="/admin/*"
          element={
            <AdminGuard>
              <div data-testid="admin-content">admin portal</div>
            </AdminGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminGuard', () => {
  it('signed out: redirects without asking the server', async () => {
    mountAdmin()
    expect(await screen.findByTestId('landing')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('never shows admin content before the server has answered', async () => {
    h.state.user = { id: 'u1' }
    let answer: (v: { data: boolean; error: null }) => void = () => {}
    h.rpc.mockReturnValue(new Promise((r) => { answer = r }))
    mountAdmin()
    expect(screen.getByText('Verifying admin access...')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    answer({ data: true, error: null })
    expect(await screen.findByTestId('admin-content')).toBeInTheDocument()
    expect(h.rpc).toHaveBeenCalledWith('is_platform_admin')
  })

  it('a member who is not an admin is sent to the landing page', async () => {
    h.state.user = { id: 'u1' }
    h.rpc.mockResolvedValue({ data: false, error: null })
    mountAdmin()
    expect(await screen.findByTestId('landing')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
  })

  it('only the boolean true opens the portal: truthy look-alikes do not', async () => {
    h.state.user = { id: 'u1' }
    for (const data of ['true', 1, {}, [true], null, undefined]) {
      h.rpc.mockResolvedValue({ data, error: null })
      const view = mountAdmin()
      await waitFor(() => expect(view.queryByText('Verifying admin access...')).not.toBeInTheDocument())
      expect(view.queryByTestId('admin-content'), JSON.stringify(data)).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('fails closed: a server error or a rejected call never opens the portal', async () => {
    h.state.user = { id: 'u1' }
    h.rpc.mockResolvedValue({ data: true, error: { message: 'JWT expired' } })
    const first = mountAdmin()
    await waitFor(() => expect(first.queryByText('Verifying admin access...')).not.toBeInTheDocument())
    expect(first.queryByTestId('admin-content')).not.toBeInTheDocument()
    first.unmount()

    h.rpc.mockRejectedValue(new Error('network down'))
    const second = mountAdmin()
    await waitFor(() => expect(second.queryByText('Verifying admin access...')).not.toBeInTheDocument())
    expect(second.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(second.getByText('Access Error')).toBeInTheDocument()
  })
})
