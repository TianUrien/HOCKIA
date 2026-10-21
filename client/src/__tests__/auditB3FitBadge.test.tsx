/**
 * Design audit 2026-10-21, B3: one Fit badge. Strong fit / Possible fit with a
 * bar meter, positive tone on light, glass over photos, sentence case, never a
 * percentage, and never for a player viewer.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FitBadge } from '@/components/ui/FitBadge'
import { fitStateFromVerdict } from '@/lib/recruiterVerdict'
import RecruiterVerdictCard from '@/components/recruiting/RecruiterVerdictCard'
import type { RecruiterVerdict } from '@/lib/recruiterVerdict'

describe('FitBadge', () => {
  it('reads Strong fit / Possible fit in sentence case, with three or two bars filled', () => {
    const { rerender, container } = render(<FitBadge state="green" />)
    expect(screen.getByTestId('fit-badge').textContent).toBe('Strong fit')
    expect(screen.getByTestId('fit-badge').dataset.fit).toBe('strong')
    expect(container.querySelectorAll('.bg-positive')).toHaveLength(3)
    rerender(<FitBadge state="yellow" />)
    expect(screen.getByTestId('fit-badge').textContent).toBe('Possible fit')
    expect(container.querySelectorAll('.bg-ink-1')).toHaveLength(2)
  })

  it('renders nothing for a grey or unknown fit', () => {
    const { rerender } = render(<FitBadge state="grey" />)
    expect(screen.queryByTestId('fit-badge')).toBeNull()
    rerender(<FitBadge state={null} />)
    expect(screen.queryByTestId('fit-badge')).toBeNull()
  })

  it('never renders for a player viewer', () => {
    render(<FitBadge state="green" viewerRole="player" />)
    expect(screen.queryByTestId('fit-badge')).toBeNull()
  })

  it('uses glass over photos and the positive tone on light surfaces', () => {
    const { rerender } = render(<FitBadge state="green" surface="photo" />)
    expect(screen.getByTestId('fit-badge').className).toContain('backdrop-blur')
    rerender(<FitBadge state="green" />)
    expect(screen.getByTestId('fit-badge').className).toContain('bg-positive-soft')
  })

  it('never shows a percentage, whatever the suffix', () => {
    render(<FitBadge state="green" suffix="for Midfielder · Men's" />)
    expect(screen.getByTestId('fit-badge').textContent).not.toMatch(/%/)
  })
})

describe('verdict → Fit badge', () => {
  it('maps Excellent and Good to Strong, Possible to Possible, outside the context to nothing', () => {
    expect(fitStateFromVerdict({ tier: 'pursue' })).toBe('green')
    expect(fitStateFromVerdict({ tier: 'consider' })).toBe('green')
    expect(fitStateFromVerdict({ tier: 'longshot' })).toBe('yellow')
    expect(fitStateFromVerdict({ tier: 'pass' })).toBeNull()
    expect(fitStateFromVerdict(null)).toBeNull()
  })

  it('the verdict card shows the badge and never a % or an Excellent / Out of scope word', () => {
    const verdict = {
      isApplicable: true, tier: 'pursue', headline: 'Excellent', strength: 0.87, highlights: ['Plays your position'], caveats: [], scoped: true, weightedFor: null,
    } as unknown as RecruiterVerdict
    const { container } = render(<RecruiterVerdictCard verdict={verdict} />)
    expect(screen.getByTestId('fit-badge').textContent).toBe('Strong fit')
    expect(container.textContent).not.toMatch(/%|Excellent|Out of scope/)
  })
})
