import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrestStrip, RoleCard } from '@/components/landing/RoleCards'
import { stagger, prefersReducedMotion } from '@/lib/motion'
import { useScrolled } from '@/hooks/useScrolled'
import { renderHook, act } from '@testing-library/react'
import type { OpenRoleCard } from '@/lib/landingRoles'

/**
 * Motion is a progressive enhancement on a CONVERSION page. The invariant that
 * actually matters is not that the animations are pretty — it's that content
 * is never stranded invisible when the enhancement doesn't run. Every test
 * here is about the failure path.
 */

// RoleCards imports lib/landingRoles → lib/supabase, which THROWS at import
// without the env vars (absent in the CI unit job). Nothing here fetches.
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }))

afterEach(() => vi.unstubAllGlobals())

const CRESTS = [
  { name: 'Hockey Team Bologna', url: 'https://cdn/htb.png' },
  { name: 'KHCB', url: 'https://cdn/khcb.png' },
]

const ROLE: OpenRoleCard = {
  id: 'r1', clubName: 'Hockey Team Bologna', crestUrl: 'https://cdn/htb.png', city: 'Bologna', country: 'Italy',
  flag: '🇮🇹', league: 'Serie A1', position: 'Forward', team: "Women's", when: 'Starts 16 Sep · 3 months',
  packages: ['Housing', 'Flights', 'Job', 'Car'], createdAt: '2026-10-03T12:00:00Z',
}

function stubReducedMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
}

describe('CrestStrip', () => {
  it('renders every crest with the club name as its tooltip, with the 60 ms stagger', async () => {
    render(<CrestStrip crests={CRESTS} />)
    const imgs = await screen.findAllByRole('img')
    expect(imgs.map((i) => i.getAttribute('title'))).toEqual(['Hockey Team Bologna', 'KHCB'])
    // jsdom has no layout, so visibility arrives via useInView's 1.5 s failsafe.
    await waitFor(() => expect((imgs[1].parentElement as HTMLElement).style.opacity).toBe('1'), { timeout: 3000 })
    expect((imgs[1].parentElement as HTMLElement).style.transition).toMatch(/ 60ms/)
    expect((imgs[0].parentElement as HTMLElement).style.transition).toMatch(/ 0ms/)
  })

  it('is VISIBLE without IntersectionObserver — the enhancement can fail, the crests cannot', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<CrestStrip crests={CRESTS} />)
    await waitFor(() => {
      const li = screen.getAllByRole('img')[0].parentElement as HTMLElement
      expect(li.style.opacity).toBe('1')
    })
  })

  it('does not animate under prefers-reduced-motion', async () => {
    stubReducedMotion()
    render(<CrestStrip crests={CRESTS} />)
    const li = (await screen.findAllByRole('img'))[0].parentElement as HTMLElement
    expect(li.style.transition).toBe('none')
    expect(li.style.opacity).toBe('1')
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<CrestStrip crests={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RoleCard', () => {
  it('is one link with the hover lift, three chips + overflow, and the posted-ago on the right', () => {
    render(
      <MemoryRouter>
        <RoleCard role={ROLE} now={new Date('2026-10-06T12:00:00Z')} />
      </MemoryRouter>,
    )
    const card = screen.getByTestId('role-card')
    expect(card.tagName).toBe('A')
    expect(card).toHaveAttribute('href', '/opportunities/r1')
    expect(card.className).toMatch(/hover:-translate-y-1/)
    expect(card.className).toMatch(/hover:border-brand-primary\/35/)
    expect(card.className).toMatch(/duration-200/)
    expect(card.className).toMatch(/motion-reduce:transition-none/)
    expect(screen.getByRole('list', { name: 'Package' })).toHaveTextContent('HousingFlightsJob+1')
    expect(screen.getByLabelText('Posted 3d')).toHaveTextContent('3d')
    expect(card).toHaveTextContent('🇮🇹 Bologna, Italy · Serie A1')
  })
})

describe('useScrolled', () => {
  it('flips past the threshold and back', () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const { result } = renderHook(() => useScrolled(8))
    expect(result.current).toBe(false)
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 9, configurable: true })
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(true)
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 8, configurable: true })
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(false)
  })
})

describe('stagger', () => {
  it('spaces siblings out', () => {
    expect(stagger(0)).toBe(0)
    expect(stagger(1)).toBe(70)
    expect(stagger(3)).toBe(210)
  })

  it('CAPS the delay so a long list never leaves the last item waiting', () => {
    // Without the cap a 20-item list would delay the last entrance by 1.4s,
    // which reads as "broken", not "choreographed".
    expect(stagger(6)).toBe(stagger(20))
    expect(stagger(50)).toBeLessThanOrEqual(420)
  })
})

describe('prefersReducedMotion', () => {
  it('is false — not a crash — where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
