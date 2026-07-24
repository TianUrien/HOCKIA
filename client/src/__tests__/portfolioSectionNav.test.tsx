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
})
