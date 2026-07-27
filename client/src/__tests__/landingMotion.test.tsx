import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleCards from '@/components/landing/RoleCards'
import { stagger, prefersReducedMotion } from '@/lib/motion'

/**
 * Motion is a progressive enhancement on a CONVERSION page. The invariant that
 * actually matters is not that the animations are pretty — it's that content
 * is never stranded invisible when the enhancement doesn't run. Every test
 * here is about the failure path.
 */

afterEach(() => vi.unstubAllGlobals())

const ROLES = ['Players', 'Coaches', 'Clubs', 'Brands', 'Umpires', 'Everyone else']

describe('RoleCards', () => {
  it('renders every role', async () => {
    render(<RoleCards />)
    for (const r of ROLES) {
      expect(await screen.findByRole('heading', { name: r })).toBeInTheDocument()
    }
  })

  it('is VISIBLE without IntersectionObserver — the enhancement can fail, the copy cannot', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<RoleCards />)
    await waitFor(() => {
      const card = screen.getByRole('heading', { name: 'Players' }).closest('article')!
      expect(card.style.opacity).toBe('1')
    })
  })

  it('is NOT a tab stop while it is a grid — a focus stop that does nothing', async () => {
    // jsdom reports zero scroll extent, which is the desktop grid case.
    render(<RoleCards />)
    const rail = await screen.findByRole('group', { name: /who hockia is built for/i })
    expect(rail).not.toHaveAttribute('tabindex')
  })

  it('renders NO position dots when the rail cannot scroll', async () => {
    // Dots that can't do anything are worse than no dots.
    render(<RoleCards />)
    await screen.findByRole('heading', { name: 'Players' })
    expect(screen.queryByRole('button', { name: /^Show / })).not.toBeInTheDocument()
  })

  it('BECOMES a keyboard-operable region with dots once it scrolls', async () => {
    // The carousel case: a scrollable region with no focusable children is
    // unreachable by keyboard unless it is itself a tab stop.
    const w = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1800)
    const c = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    try {
      render(<RoleCards />)
      const rail = await screen.findByRole('group', { name: /who hockia is built for/i })
      await waitFor(() => expect(rail).toHaveAttribute('tabindex', '0'))
      expect(await screen.findAllByRole('button', { name: /^Show / })).toHaveLength(ROLES.length)
    } finally {
      w.mockRestore()
      c.mockRestore()
    }
  })

  it('does not animate under prefers-reduced-motion', async () => {
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
    render(<RoleCards />)
    const card = (await screen.findByRole('heading', { name: 'Players' })).closest('article')!
    expect(card.style.transition).toBe('none')
    expect(card.style.opacity).toBe('1')
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
