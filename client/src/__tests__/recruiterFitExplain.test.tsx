/**
 * "Why this fit" content (founder decision 2026-10-21): the verdict card with
 * each criterion met or missed, never a percentage, and the Hockia AI fit
 * opinion with its Beta label.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ applicable: true }))

vi.mock('@/hooks/useCandidateVerdict', () => ({
  useCandidateVerdict: () => ({
    fit: null,
    verdict: {
      isApplicable: mocks.applicable, tier: 'consider', headline: 'Good', strength: 0.68,
      highlights: ['Plays your position', 'Open to play'], caveats: ['No highlights video yet'], scoped: true, weightedFor: null,
    },
  }),
}))
vi.mock('@/components/recruiting/AIOpinionPanel', () => ({ default: () => <section data-testid="ai-opinion-panel">Hockia AI · fit opinion <span>Beta</span></section> }))

import RecruiterFitExplain from '@/components/recruiting/RecruiterFitExplain'
import type { Profile } from '@/components/community/PeopleListView'

const member = { id: 'p1', role: 'player', full_name: 'Ana Ruiz' } as unknown as Profile

describe('RecruiterFitExplain', () => {
  it('lists each criterion and the AI opinion, with no percentage or tier word', () => {
    const { container } = render(<RecruiterFitExplain member={member} />)
    expect(screen.getByText('Plays your position')).toBeInTheDocument()
    expect(screen.getByText('Open to play')).toBeInTheDocument()
    expect(screen.getByText('No highlights video yet')).toBeInTheDocument()
    expect(screen.getByTestId('fit-badge')).toHaveTextContent('Strong fit')
    expect(screen.getByTestId('ai-opinion-panel')).toHaveTextContent('Beta')
    expect(container.textContent).not.toMatch(/%|Good\b|Excellent/)
  })

  it('without a context it says how to get one', () => {
    mocks.applicable = false
    render(<RecruiterFitExplain member={member} />)
    expect(screen.getByText(/Choose a context in Ranked for/)).toBeInTheDocument()
    mocks.applicable = true
  })

  it('the real AI opinion panel carries the Beta label', async () => {
    const src = (await import('@/components/recruiting/AIOpinionPanel.tsx?raw')).default
    expect(src).toContain('<BetaPill testId="ai-opinion-beta" />')
  })
})
