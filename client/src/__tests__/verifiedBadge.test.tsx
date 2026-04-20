import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VerifiedBadge from '@/components/VerifiedBadge'

describe('VerifiedBadge', () => {
  it('renders nothing when verified is false', () => {
    const { container } = render(<VerifiedBadge verified={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when verified is null or undefined', () => {
    const { container: a } = render(<VerifiedBadge verified={null} />)
    expect(a).toBeEmptyDOMElement()
    const { container: b } = render(<VerifiedBadge verified={undefined} />)
    expect(b).toBeEmptyDOMElement()
  })

  it('renders a verified img-role element when verified is true', () => {
    render(<VerifiedBadge verified={true} />)
    const badge = screen.getByRole('img', { name: /verified profile/i })
    expect(badge).toBeInTheDocument()
  })

  it('includes the grant month/year in the tooltip when verifiedAt is provided', () => {
    render(<VerifiedBadge verified={true} verifiedAt="2026-03-15T10:00:00.000Z" />)
    const badge = screen.getByRole('img', { name: /verified profile/i })
    // Title should contain the year (locale-agnostic month formatting is hard to assert exactly).
    expect(badge.getAttribute('title')).toMatch(/2026/)
    expect(badge.getAttribute('title')).toMatch(/Verified by HOCKIA/i)
  })

  it('falls back to a plain tooltip when verifiedAt is missing', () => {
    render(<VerifiedBadge verified={true} />)
    const badge = screen.getByRole('img', { name: /verified profile/i })
    expect(badge.getAttribute('title')).toBe('Verified by HOCKIA')
  })

  it('uses smaller icon sizing in the sm variant', () => {
    const { container } = render(<VerifiedBadge verified={true} size="sm" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('w-3.5')
    expect(svg?.getAttribute('class')).toContain('h-3.5')
  })

  it('tolerates a malformed verifiedAt without throwing', () => {
    render(<VerifiedBadge verified={true} verifiedAt="not-a-date" />)
    const badge = screen.getByRole('img', { name: /verified profile/i })
    // Falls through to the plain tooltip rather than "Verified by HOCKIA — ".
    expect(badge.getAttribute('title')).toBe('Verified by HOCKIA')
  })
})
