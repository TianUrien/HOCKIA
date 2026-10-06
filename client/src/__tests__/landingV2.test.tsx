import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clubCrests,
  clubInitials,
  openRoleTitle,
  packageLabel,
  placeLine,
  postedAgo,
  teamTag,
  toOpenRoleCard,
  whenLine,
  flagFor,
} from '@/lib/landingRoles'

/**
 * Web landing "Landing v3" (Figma Hockia-UI-UX 122:1885, approved 6 Oct 2026).
 * Pins: the verbatim copy, the fixed navbar and its scrolled capsule state,
 * the open-roles band (hidden at 0, newest three cards otherwise, each card
 * → its role page, crest strip from the wider read), the dark closing panel,
 * the web-only store badges, the nav targets and reduced-motion handling.
 */

const h = vi.hoisted(() => ({
  native: { value: false },
  invoke: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native.value } }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: h.invoke }, rpc: h.rpc, from: h.from } }))
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

const NOW = new Date('2026-10-06T12:00:00Z')

/** Public API shape (supabase/functions/_shared/public-api-types.ts). */
const ROWS = [
  {
    id: 'r1', title: 'Forward', position: 'forward', gender: 'Women',
    start_date: '2026-09-16', duration: '3 months', benefits: ['housing', 'flights', 'job'],
    created_at: '2026-10-03T12:00:00Z',
    club: { name: 'Hockey Team Bologna', logo_url: 'https://cdn/htb.png', league: 'Serie A1', kind: 'club' as const },
    location: { city: 'Bologna', country: 'Italy' },
  },
  {
    id: 'r2', title: 'Head Coach wanted', position: 'head_coach', gender: 'Men',
    start_date: null, duration: '12', benefits: ['housing', 'car', 'visa', 'bonuses', 'insurance'],
    created_at: '2026-09-15T12:00:00Z',
    club: { name: 'KHCB', logo_url: 'https://cdn/khcb.png', league: null, kind: 'club' as const },
    location: { city: 'Barcelona', country: 'Spain' },
  },
  {
    id: 'r3', title: '', position: 'midfielder', gender: null,
    start_date: null, duration: null, benefits: [],
    created_at: '2026-10-01T12:00:00Z',
    club: { name: 'Unknown Club', logo_url: null, league: null, kind: 'coach' as const },
    location: { city: '', country: 'Argentina' },
  },
  // Only feeds the crest strip (the cards are the newest three).
  {
    id: 'r4', title: 'Goalkeeper', position: 'goalkeeper', gender: 'Women',
    created_at: '2026-09-01T12:00:00Z',
    club: { name: 'Kilkenny Hockey Club', logo_url: 'https://cdn/kilkenny.png', league: 'Leinster Division 1', kind: 'club' as const },
    location: { city: 'Kilkenny', country: 'Ireland' },
  },
]

const COUNTRIES = [
  { name: 'Italy', common_name: null, flag_emoji: '🇮🇹' },
  { name: 'Spain', common_name: null, flag_emoji: '🇪🇸' },
  { name: 'Ireland', common_name: null, flag_emoji: '🇮🇪' },
]

function arm(rows: unknown[] | null, error: Error | null = null) {
  h.invoke.mockResolvedValue({ data: rows === null ? null : { data: rows }, error })
  h.from.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: COUNTRIES, error: null }) })
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

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: matches && q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
}

beforeEach(() => arm([]))
afterEach(() => {
  h.native.value = false
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('Landing v3 — copy', () => {
  it('renders the hero, closing panel and footnotes verbatim', async () => {
    await renderLanding()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/^The network for\s*field hockey\.$/)
    expect(screen.getByText('Build your hockey profile, connect with clubs worldwide and find your next move.')).toBeInTheDocument()
    expect(screen.getByText('For players, coaches, clubs, umpires and brands.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /One community for\s*the whole game\./ })).toBeInTheDocument()
    expect(screen.getByText('Free for players, coaches, clubs, umpires and brands.')).toBeInTheDocument()
    expect(screen.getAllByText('Get the app').length).toBeGreaterThan(0)
    // Every "Create a profile" CTA points at signup (nav, hero, closing panel).
    const signups = screen.getAllByRole('link', { name: 'Create a profile' })
    expect(signups.length).toBe(3)
    for (const a of signups) expect(a).toHaveAttribute('href', '/signup')
    // The text link keeps the "Explore Hockia" target.
    expect(screen.getByRole('link', { name: /explore without an account/i })).toHaveAttribute('href', '/community')
    // The closing panel's Log in goes to /signin.
    const panel = screen.getByTestId('closing-panel')
    expect(within(panel).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/signin')
  })

  it('no longer renders the previous landing\'s lines', async () => {
    await renderLanding()
    expect(h.rpc).not.toHaveBeenCalled()
    expect(screen.queryByText(/Already a member\?/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Clubs publish real roles/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No account needed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('uses gender-neutral copy', async () => {
    const { container } = await renderLanding()
    expect(container.textContent).not.toMatch(/\b(his|her|him)\b/i)
  })

  it('keeps the three product screenshots in their device frames', async () => {
    const { container } = await renderLanding()
    const stage = container.querySelector('[data-stage]')!
    const srcs = Array.from(stage.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['/landing/phone-community.png', '/landing/phone-feed.jpg', '/landing/phone-firstrun.webp'])
    expect(stage.querySelectorAll('[data-phone]')).toHaveLength(3)
    expect(stage.querySelector('[data-phone="front"] img')).toHaveAttribute('fetchpriority', 'high')
  })
})

describe('Landing v3 — nav', () => {
  it('links Explore / Opportunities / For clubs / Log in to the same targets as before', async () => {
    await renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/community')
    expect(within(nav).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('href', '/opportunities')
    expect(within(nav).getByRole('link', { name: 'For clubs' })).toHaveAttribute('href', '/world')
    expect(within(nav).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/signin')
    expect(within(nav).getByRole('link', { name: 'Create a profile' })).toHaveAttribute('href', '/signup')
    expect(within(nav).getByRole('link', { name: 'HOCKIA home' })).toHaveAttribute('href', '/')
  })

  it('is fixed, transparent at the top and a glass capsule once scrollY passes 8', async () => {
    await renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const bar = screen.getByTestId('nav-bar')
    expect(nav.className).toMatch(/\bfixed\b/)
    expect(nav).toHaveAttribute('data-state', 'top')
    expect(bar.className).toMatch(/bg-transparent/)
    expect(bar.className).toMatch(/max-w-\[1280px\]/)
    // The phone capsule's "Create a profile" is hidden at the top.
    expect(within(nav).getByRole('link', { name: 'Create a profile' }).className).toMatch(/\bhidden\b/)

    // Exactly the threshold is still "top".
    Object.defineProperty(window, 'scrollY', { value: 8, configurable: true })
    fireEvent.scroll(window)
    expect(nav).toHaveAttribute('data-state', 'top')

    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true })
    fireEvent.scroll(window)
    expect(nav).toHaveAttribute('data-state', 'scrolled')
    expect(bar.className).toMatch(/max-w-\[1040px\]/)
    expect(bar.className).toMatch(/backdrop-blur-\[20px\]/)
    expect(bar.className).toMatch(/bg-white\/\[0\.72\]/)
    expect(bar.className).toMatch(/border-line\b/)
    expect(bar.className).toMatch(/motion-reduce:transition-none/)
    expect(within(nav).getByRole('link', { name: 'Create a profile' }).className).not.toMatch(/\bhidden\b/)

    // Back to the top.
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    fireEvent.scroll(window)
    expect(nav).toHaveAttribute('data-state', 'top')
  })
})

describe('Landing v3 — motion', () => {
  it('plays the load choreography from a class set at hydration (static HTML has none)', async () => {
    stubReducedMotion(false)
    await renderLanding()
    const hero = screen.getByTestId('hero')
    expect(hero.className).toMatch(/\blv3-enter\b/)
    // The copy carries only a delay variable — no inline opacity/transform
    // that could hide the static HTML.
    const h1 = screen.getByRole('heading', { level: 1 })
    for (const line of Array.from(h1.querySelectorAll('[data-enter]'))) {
      expect((line as HTMLElement).style.opacity).toBe('')
      expect((line as HTMLElement).style.transform).toBe('')
    }
  })

  it('does nothing under prefers-reduced-motion', async () => {
    stubReducedMotion(true)
    const { container } = await renderLanding()
    expect(screen.getByTestId('hero').className).not.toMatch(/\blv3-enter\b/)
    // The closing panel reveal collapses to its final state instantly.
    const reveal = screen.getByTestId('closing-panel').parentElement as HTMLElement
    expect(reveal.style.transition).toBe('none')
    await waitFor(() => expect(reveal.style.opacity).toBe('1'))
    expect(container.querySelector('[data-float]')).toBeTruthy()
  })

  it('skips the load choreography on a prerendered load', async () => {
    stubReducedMotion(false)
    ;(window as unknown as { __PRERENDERED_LANDING__?: boolean }).__PRERENDERED_LANDING__ = true
    try {
      await renderLanding()
      expect(screen.getByTestId('hero').className).not.toMatch(/\blv3-enter\b/)
    } finally {
      delete (window as unknown as { __PRERENDERED_LANDING__?: boolean }).__PRERENDERED_LANDING__
    }
  })
})

describe('Landing v3 — open roles', () => {
  it('hides the whole section when there are no open roles', async () => {
    arm([])
    await renderLanding()
    await waitFor(() => expect(h.invoke).toHaveBeenCalled())
    expect(screen.queryByText('Open roles')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your next club could be anywhere.' })).not.toBeInTheDocument()
    expect(h.from).not.toHaveBeenCalled()
  })

  it('hides the section when the read fails', async () => {
    arm(null, new Error('boom'))
    await renderLanding()
    await waitFor(() => expect(h.invoke).toHaveBeenCalled())
    expect(screen.queryByText('Open roles')).not.toBeInTheDocument()
  })

  it('shows the newest three as cards, each one link to its role page, with the crest strip from the wider read', async () => {
    arm(ROWS)
    await renderLanding()
    expect(await screen.findByRole('heading', { name: 'Your next club could be anywhere.' })).toBeInTheDocument()
    // The API reads public_opportunities as service role, ordered created_at desc.
    expect(h.invoke).toHaveBeenCalledWith('public-opportunities?limit=12', { method: 'GET' })
    expect(h.from).toHaveBeenCalledWith('countries')

    const cards = screen.getAllByTestId('role-card')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveAttribute('href', '/opportunities/r1')
    expect(within(cards[0]).getByRole('heading', { level: 3 })).toHaveTextContent('Forward')
    expect(cards[0]).toHaveTextContent('Hockey Team Bologna')
    expect(cards[0]).toHaveTextContent('🇮🇹')
    expect(cards[0]).toHaveTextContent('Bologna, Italy · Serie A1')
    expect(cards[0]).toHaveTextContent("Women's")
    expect(cards[0]).toHaveTextContent('Starts 16 Sep · 3 months')
    expect(within(cards[0]).getByRole('list', { name: 'Package' })).toHaveTextContent('HousingFlightsJob')
    expect(cards[0]).toHaveTextContent('Apply in the app')
    expect(cards[0]).toHaveTextContent('View role')
    // Crest = the club avatar, drawn with multiply over white.
    const crest = within(cards[0]).getAllByRole('presentation')[0] as HTMLImageElement
    expect(crest.getAttribute('src')).toBe('https://cdn/htb.png')
    expect(crest.className).toMatch(/\blv3-crest\b/)

    expect(cards[1]).toHaveAttribute('href', '/opportunities/r2')
    expect(cards[1]).toHaveTextContent('Head coach')
    expect(cards[1]).toHaveTextContent('Starts immediately · 12 months')
    // Max three chips + the overflow.
    expect(within(cards[1]).getByRole('list', { name: 'Package' })).toHaveTextContent('HousingCarVisa+2')

    // Missing data → the line is omitted, never a placeholder.
    expect(cards[2]).toHaveAttribute('href', '/opportunities/r3')
    expect(cards[2]).toHaveTextContent('Midfielder')
    expect(cards[2]).not.toHaveTextContent('Unknown Club')
    expect(cards[2]).toHaveTextContent('Argentina')
    expect(cards[2]).not.toHaveTextContent('Starts')
    expect(within(cards[2]).queryByRole('list', { name: 'Package' })).not.toBeInTheDocument()
    expect(within(cards[2]).queryByRole('presentation')).not.toBeInTheDocument()

    // The crest strip: unique clubs with a crest, including the row beyond the three cards.
    const strip = screen.getByTestId('crest-strip')
    expect(strip).toHaveTextContent('Clubs recruiting on Hockia')
    const crests = within(strip).getAllByRole('img')
    expect(crests.map((i) => i.getAttribute('alt'))).toEqual(['Hockey Team Bologna', 'KHCB', 'Kilkenny Hockey Club'])
    expect(crests[0]).toHaveAttribute('title', 'Hockey Team Bologna')

    // "See all open roles" → /opportunities.
    for (const a of screen.getAllByRole('link', { name: /see all open roles/i })) expect(a).toHaveAttribute('href', '/opportunities')
  })

  it('still shows the cards when the flag lookup fails', async () => {
    arm(ROWS)
    h.from.mockReturnValue({ select: vi.fn().mockRejectedValue(new Error('rls')) })
    await renderLanding()
    const cards = await screen.findAllByTestId('role-card')
    expect(cards).toHaveLength(3)
    expect(cards[0]).not.toHaveTextContent('🇮🇹')
    expect(cards[0]).toHaveTextContent('Bologna, Italy · Serie A1')
  })
})

describe('Landing v3 — store badges', () => {
  it('shows the official badges on the web, inside the pre-hydration native gate', async () => {
    h.native.value = false
    const { container } = await renderLanding()
    // Hero (desktop + phone rows) and the closing panel.
    expect(screen.getAllByRole('link', { name: /App Store/i })).toHaveLength(3)
    expect(screen.getAllByRole('link', { name: /Google Play/i })).toHaveLength(3)
    expect(container.querySelectorAll('[data-store-badges]')).toHaveLength(3)
  })

  it('hides them inside the native app', async () => {
    h.native.value = true
    await renderLanding()
    expect(screen.queryByRole('link', { name: /App Store/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Google Play/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Get the app')).not.toBeInTheDocument()
  })
})

describe('landingRoles helpers', () => {
  it('titles: typed title wins, bare position label falls back to "<Position> wanted"', () => {
    expect(openRoleTitle({ title: 'U18 keeper for the summer', position: 'goalkeeper' })).toBe('U18 keeper for the summer')
    expect(openRoleTitle({ title: 'goalkeeper', position: 'goalkeeper' })).toBe('Goalkeeper wanted')
    expect(openRoleTitle({ title: '  ', position: 'head_coach' })).toBe('Head coach wanted')
    expect(openRoleTitle({ title: null, position: null })).toBe('Open role')
  })

  it('maps a public row to the card: position, team, when, packages, place; "Unknown Club" is dropped', () => {
    const card = toOpenRoleCard(ROWS[0], NOW)!
    expect(card).toMatchObject({
      id: 'r1', clubName: 'Hockey Team Bologna', crestUrl: 'https://cdn/htb.png', city: 'Bologna', country: 'Italy',
      league: 'Serie A1', position: 'Forward', team: "Women's", when: 'Starts 16 Sep · 3 months',
      packages: ['Housing', 'Flights', 'Job'], createdAt: '2026-10-03T12:00:00Z', flag: null,
    })
    expect(placeLine(card)).toBe('Bologna, Italy · Serie A1')
    const unknown = toOpenRoleCard(ROWS[2], NOW)!
    expect(unknown.clubName).toBeNull()
    expect(unknown.crestUrl).toBeNull()
    expect(unknown.position).toBe('Midfielder')
    expect(unknown.team).toBeNull()
    expect(unknown.when).toBeNull()
    expect(unknown.packages).toEqual([])
    expect(placeLine(unknown)).toBe('Argentina')
    expect(toOpenRoleCard({ ...ROWS[0], id: null })).toBeNull()
    // A role without a position falls back to its title.
    expect(toOpenRoleCard({ id: 'x', title: 'Assistant coach wanted', position: null }, NOW)?.position).toBe('Assistant coach wanted')
  })

  it('team tag: possessive team names per opportunity_gender', () => {
    expect(teamTag('Women')).toBe("Women's")
    expect(teamTag('Men')).toBe("Men's")
    expect(teamTag('Girls')).toBe("Girls'")
    expect(teamTag('Boys')).toBe("Boys'")
    expect(teamTag('Mixed')).toBe('Mixed')
    expect(teamTag(null)).toBeNull()
    expect(teamTag('whatever')).toBeNull()
  })

  it('when line: day first, bare integers mean months, nothing → null', () => {
    expect(whenLine({ start_date: '2026-09-16', duration: '3 months' }, NOW)).toBe('Starts 16 Sep · 3 months')
    expect(whenLine({ start_date: '2027-01-10', duration: null }, NOW)).toBe('Starts 10 Jan 2027')
    expect(whenLine({ start_date: null, duration: 'Full season' }, NOW)).toBe('Starts immediately · Full season')
    expect(whenLine({ start_date: null, duration: '1' }, NOW)).toBe('Starts immediately · 1 month')
    expect(whenLine({ start_date: null, duration: '' }, NOW)).toBeNull()
  })

  it('package chips: known keys get their label, custom text is shown as written', () => {
    expect(packageLabel('housing')).toBe('Housing')
    expect(packageLabel('PAID')).toBe('Paid')
    expect(packageLabel('gym membership')).toBe('Gym membership')
    expect(packageLabel('  ')).toBeNull()
    expect(toOpenRoleCard({ id: 'x', benefits: ['housing', 'Housing', null, 'car'] }, NOW)?.packages).toEqual(['Housing', 'Car'])
  })

  it('posted-ago: now / m / h / d / w / mo, never "ago"', () => {
    const at = (iso: string) => postedAgo(iso, NOW)
    expect(at('2026-10-06T11:59:40Z')).toBe('now')
    expect(at('2026-10-06T11:56:00Z')).toBe('4m')
    expect(at('2026-10-06T10:00:00Z')).toBe('2h')
    expect(at('2026-10-03T12:00:00Z')).toBe('3d')
    expect(at('2026-09-15T12:00:00Z')).toBe('3w')
    expect(at('2026-07-01T12:00:00Z')).toBe('3mo')
    expect(at('2026-10-07T12:00:00Z')).toBe('now') // clock skew: never negative
    expect(postedAgo(null, NOW)).toBe('')
    expect(at('garbage')).toBe('')
  })

  it('crest strip: unique club accounts with a crest, first appearance wins, capped, hidden under three', () => {
    const cards = ROWS.map((r) => toOpenRoleCard(r, NOW)!)
    expect(clubCrests(cards)).toEqual([
      { name: 'Hockey Team Bologna', url: 'https://cdn/htb.png' },
      { name: 'KHCB', url: 'https://cdn/khcb.png' },
      { name: 'Kilkenny Hockey Club', url: 'https://cdn/kilkenny.png' },
    ])
    expect(clubCrests([...cards, { ...cards[0], id: 'dup' }])).toHaveLength(3)
    // Fewer than three qualifying clubs → no strip at all (never a thin row).
    expect(clubCrests(cards, 2)).toEqual([])
    // A coach-published role never contributes a crest, even with a logo URL.
    const coachRole = { ...cards[0], id: 'c', clubName: 'Holcombe Hockey Club', clubAccount: false, crestUrl: 'https://cdn/jo.jpg' }
    expect(clubCrests([coachRole, cards[1], cards[3]])).toEqual([])
    expect(clubCrests([coachRole, cards[0], cards[1], cards[3]]).map((c) => c.name)).toEqual(['Hockey Team Bologna', 'KHCB', 'Kilkenny Hockey Club'])
  })

  it('initials tile: up to two letters from the first and last words', () => {
    expect(clubInitials('Hockey Team Bologna')).toBe('HB')
    expect(clubInitials('KHCB')).toBe('K')
    expect(clubInitials('  club test ')).toBe('CT')
    expect(clubInitials('')).toBe('')
  })

  it('flags match the country name or common name, case-insensitively', () => {
    const rows = [...COUNTRIES, { name: 'United Kingdom', common_name: 'England', flag_emoji: '🏴' }]
    expect(flagFor(rows, 'italy')).toBe('🇮🇹')
    expect(flagFor(rows, 'England')).toBe('🏴')
    expect(flagFor(rows, 'Narnia')).toBeNull()
    expect(flagFor(rows, null)).toBeNull()
  })
})
