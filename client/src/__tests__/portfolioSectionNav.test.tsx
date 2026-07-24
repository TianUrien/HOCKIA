import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PortfolioSectionNav from '@/components/profile/PortfolioSectionNav'

// The chips are the portfolio's map. The load-bearing rule: a chip must
// never point at a section that isn't on the page — the dashboards pass
// the SAME gate conditions the wrappers use, and the bar hides itself on
// short profiles where it would be noise.

const SECTIONS = [
  { id: 'portfolio-journey', label: 'Career' },
  { id: 'portfolio-media', label: 'Media' },
  { id: 'community-comments', label: 'Comments' },
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PortfolioSectionNav', () => {
  it('renders one chip per passed section', () => {
    render(<PortfolioSectionNav sections={SECTIONS} />)
    expect(screen.getByTestId('portfolio-section-nav')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Career' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Media' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comments' })).toBeInTheDocument()
  })

  it('hides itself below 3 sections (a 2-chip map is noise, not navigation)', () => {
    const { container } = render(<PortfolioSectionNav sections={SECTIONS.slice(0, 2)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('scrolls to the section anchor on click', () => {
    const scrollSpy = vi.fn()
    const el = document.createElement('div')
    el.id = 'portfolio-media'
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    render(<PortfolioSectionNav sections={SECTIONS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Media' }))

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(screen.getByRole('button', { name: 'Media' })).toHaveAttribute('aria-current', 'true')
  })

  it('does not throw when an anchor is missing (gated-out section)', () => {
    render(<PortfolioSectionNav sections={SECTIONS} />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Career' })),
    ).not.toThrow()
  })

  // QA 2026-07-24: in the owner's "viewing your network profile" preview,
  // PublicViewBanner is fixed at top-[68px] and taller than the header, so
  // the default 76px offset parked the chips behind it. Measured banner
  // bottoms: 146px desktop / 192px mobile (it stacks on small screens).
  it('drops below the owner-preview banner when one is on screen', () => {
    const { rerender } = render(<PortfolioSectionNav sections={SECTIONS} />)
    const nav = () => screen.getByTestId('portfolio-section-nav')
    expect(nav().className).toContain('top-[calc(76px+env(safe-area-inset-top))]')

    rerender(<PortfolioSectionNav sections={SECTIONS} hasPreviewBanner />)
    expect(nav().className).toContain('top-[calc(200px+env(safe-area-inset-top))]')
    expect(nav().className).toContain('sm:top-[calc(148px+env(safe-area-inset-top))]')
    expect(nav().className).not.toContain('top-[calc(76px+env(safe-area-inset-top))]')
  })
})
