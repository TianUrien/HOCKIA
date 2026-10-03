import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRoleTitle, toOpenRoleCard } from '@/lib/landingRoles'

/**
 * Web landing "Web A v2" (Figma Hockia-UI-UX 111:1689 / 114:1743).
 * Pins: the verbatim copy, the removed sections (live stats, role panel,
 * eyebrow pill, "No account needed"), the open-roles band (hidden at 0,
 * newest three otherwise, each card → its role page), the web-only store
 * badges and the nav targets.
 */

const h = vi.hoisted(() => ({
  native: { value: false },
  limit: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native.value } }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: null, profile: null, profileStatus: 'missing', loading: false }
    return typeof sel === 'function' ? sel(state) : state
  },
}))
vi.mock('@/lib/contact', () => ({ useContactModal: () => vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackSignupCtaClick: vi.fn(), trackCtaClick: vi.fn() }))
vi.mock('@/lib/nativeUi', () => ({ setStatusBarForBackground: vi.fn() }))
vi.mock('@/components', () => ({ InAppBrowserWarning: () => null }))

const ROWS = [
  { id: 'r1', title: 'Goalkeeper', position: 'goalkeeper', organization_name: null, world_club_name: 'Quilmes Atlético Club', publisher_current_club: null, club_name: 'Quilmes AC', location_country: 'Argentina' },
  { id: 'r2', title: 'Head Coach wanted', position: 'head_coach', organization_name: 'KHCB', world_club_name: null, publisher_current_club: null, club_name: 'Someone', location_country: 'Spain' },
  { id: 'r3', title: '', position: 'forward', organization_name: null, world_club_name: null, publisher_current_club: 'Puerto Belgrano HC', club_name: 'Someone', location_country: 'Argentina' },
]

function arm(rows: unknown[] | null, error: Error | null = null) {
  h.limit.mockResolvedValue({ data: rows, error })
  h.order.mockReturnValue({ limit: h.limit })
  h.select.mockReturnValue({ order: h.order })
  h.from.mockReturnValue({ select: h.select })
}

async function renderLanding() {
  vi.resetModules()
  const { default: Landing } = await import('@/pages/Landing')
  const view = render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
  // Flush the open-roles fetch so its state update lands inside act().
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return view
}

beforeEach(() => arm([]))
afterEach(() => {
  h.native.value = false
  vi.clearAllMocks()
})

describe('Landing v2 — copy', () => {
  it('renders the hero, final CTA and footnotes verbatim', async () => {
    await renderLanding()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/^The network for\s+field hockey\.$/)
    expect(screen.getByText('Build your hockey profile, connect with clubs worldwide and find your next move.')).toBeInTheDocument()
    expect(screen.getByText('For players, coaches, clubs, umpires and brands.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'One community for the whole game.' })).toBeInTheDocument()
    expect(screen.getByText(/Already a member\?/)).toBeInTheDocument()
    // Both "Create a profile" CTAs point at signup (nav is desktop-only but in the DOM).
    const signups = screen.getAllByRole('link', { name: 'Create a profile' })
    expect(signups.length).toBeGreaterThanOrEqual(2)
    for (const a of signups) expect(a).toHaveAttribute('href', '/signup')
    // The text link keeps the old "Explore Hockia" target.
    expect(screen.getByRole('link', { name: /explore without an account/i })).toHaveAttribute('href', '/community')
  })

  it('no longer renders the live stats, eyebrow pill, role panel or "no account" line', async () => {
    await renderLanding()
    expect(h.rpc).not.toHaveBeenCalled()
    expect(screen.queryByText(/Where field hockey sticks together/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No account needed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Or get the app/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText(/nationalities/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/clubs mapped/i)).not.toBeInTheDocument()
  })

  it('uses gender-neutral copy', async () => {
    const { container } = await renderLanding()
    expect(container.textContent).not.toMatch(/\b(his|her|him)\b/i)
  })
})

describe('Landing v2 — nav', () => {
  it('links Explore / Opportunities / For clubs / Log in to the same targets as before', async () => {
    await renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/community')
    expect(within(nav).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('href', '/opportunities')
    expect(within(nav).getByRole('link', { name: 'For clubs' })).toHaveAttribute('href', '/world')
    for (const a of within(nav).getAllByRole('link', { name: 'Log in' })) expect(a).toHaveAttribute('href', '/signin')
    expect(within(nav).getByRole('link', { name: 'HOCKIA home' })).toHaveAttribute('href', '/')
  })
})

describe('Landing v2 — open roles', () => {
  it('hides the whole section when there are no open roles', async () => {
    arm([])
    await renderLanding()
    await waitFor(() => expect(h.limit).toHaveBeenCalled())
    expect(screen.queryByText('Open roles')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your next club could be anywhere.' })).not.toBeInTheDocument()
    expect(screen.queryByText('Clubs publish real roles. Apply in the app.')).not.toBeInTheDocument()
  })

  it('hides the section when the read fails', async () => {
    arm(null, new Error('boom'))
    await renderLanding()
    await waitFor(() => expect(h.limit).toHaveBeenCalled())
    expect(screen.queryByText('Open roles')).not.toBeInTheDocument()
  })

  it('shows the newest three from public_opportunities, each linking to its role page', async () => {
    arm(ROWS)
    await renderLanding()
    expect(await screen.findByRole('heading', { name: 'Your next club could be anywhere.' })).toBeInTheDocument()
    expect(h.from).toHaveBeenCalledWith('public_opportunities')
    expect(h.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(h.limit).toHaveBeenCalledWith(3)

    const list = screen.getByRole('list')
    const cards = within(list).getAllByRole('link')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveAttribute('href', '/opportunities/r1')
    expect(cards[0]).toHaveTextContent('Goalkeeper wanted')
    expect(cards[0]).toHaveTextContent('Quilmes Atlético Club · Argentina')
    expect(cards[1]).toHaveAttribute('href', '/opportunities/r2')
    expect(cards[1]).toHaveTextContent('Head Coach wanted')
    expect(cards[1]).toHaveTextContent('KHCB · Spain')
    expect(cards[2]).toHaveAttribute('href', '/opportunities/r3')
    expect(cards[2]).toHaveTextContent('Forward wanted')
    expect(cards[2]).toHaveTextContent('Puerto Belgrano HC · Argentina')
    expect(screen.getByText('Clubs publish real roles. Apply in the app.')).toBeInTheDocument()
  })
})

describe('Landing v2 — store badges', () => {
  it('shows the official badges on the web, inside the pre-hydration native gate', async () => {
    h.native.value = false
    const { container } = await renderLanding()
    expect(screen.getByRole('link', { name: /App Store/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Google Play/i })).toBeInTheDocument()
    expect(container.querySelector('[data-store-badges]')).not.toBeNull()
  })

  it('hides them inside the native app', async () => {
    h.native.value = true
    await renderLanding()
    expect(screen.queryByRole('link', { name: /App Store/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Google Play/i })).not.toBeInTheDocument()
  })
})

describe('landingRoles helpers', () => {
  it('titles: typed title wins, bare position label falls back to "<Position> wanted"', () => {
    expect(openRoleTitle({ title: 'U18 keeper for the summer', position: 'goalkeeper' })).toBe('U18 keeper for the summer')
    expect(openRoleTitle({ title: 'goalkeeper', position: 'goalkeeper' })).toBe('Goalkeeper wanted')
    expect(openRoleTitle({ title: '  ', position: 'head_coach' })).toBe('Head coach wanted')
    expect(openRoleTitle({ title: null, position: null })).toBe('Open role')
  })

  it('meta: organisation, then world club, then publisher club; country appended', () => {
    expect(toOpenRoleCard(ROWS[0])?.meta).toBe('Quilmes Atlético Club · Argentina')
    expect(toOpenRoleCard({ ...ROWS[2], location_country: null })?.meta).toBe('Puerto Belgrano HC')
    expect(toOpenRoleCard({ ...ROWS[0], id: null })).toBeNull()
  })
})
