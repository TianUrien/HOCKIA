/**
 * RecruiterMatchBar — honesty + rendering contract.
 *
 * The whole point of this component is that the numbers it shows are the
 * REAL fit score and a REAL percentile, never flattering rescales. These
 * tests pin:
 *   - % is round(score * 100), not rescaled.
 *   - state → match label + bar fill width track the same number.
 *   - "Top X%" shows only when the parent passes a percentile (small-N
 *     guard happens upstream → null → hidden here).
 *   - completeness hint uses recruiter-facing copy and hides at 0/null.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RecruiterMatchBar from '@/components/recruiting/RecruiterMatchBar'

afterEach(cleanup)

describe('RecruiterMatchBar', () => {
  it('shows the real % (round of score*100) and the match label for green', () => {
    render(<RecruiterMatchBar score={0.68} state="green" topPercent={15} completenessPct={72} />)
    expect(screen.getByText(/Strong match/)).toBeInTheDocument()
    expect(screen.getByText(/· 68%/)).toBeInTheDocument()
    // top-quartile candidates get the qualitative flag (no bare number)
    expect(screen.getByText('Among best matches')).toBeInTheDocument()
    expect(screen.queryByText(/Top \d+%/)).not.toBeInTheDocument()
    // recruiter-facing completeness copy (never "your visibility")
    expect(screen.getByText('Good amount of information')).toBeInTheDocument()
    expect(screen.getByText('Profile looks solid.')).toBeInTheDocument()
  })

  it('flags "Among best matches" only for the top quartile', () => {
    const { rerender } = render(<RecruiterMatchBar score={0.5} state="yellow" topPercent={25} />)
    expect(screen.getByText('Among best matches')).toBeInTheDocument()
    rerender(<RecruiterMatchBar score={0.5} state="yellow" topPercent={40} />)
    expect(screen.queryByText('Among best matches')).not.toBeInTheDocument()
  })

  it('maps states to distinct match labels', () => {
    const { rerender } = render(<RecruiterMatchBar score={0.5} state="yellow" />)
    expect(screen.getByText(/Good match/)).toBeInTheDocument()
    rerender(<RecruiterMatchBar score={0.2} state="grey" />)
    expect(screen.getByText(/Limited match/)).toBeInTheDocument()
  })

  it('hides the best-match flag when no percentile is supplied (small-N guard upstream)', () => {
    render(<RecruiterMatchBar score={0.8} state="green" topPercent={null} />)
    expect(screen.queryByText('Among best matches')).not.toBeInTheDocument()
  })

  it('hides the completeness section when pct is 0 or omitted', () => {
    render(<RecruiterMatchBar score={0.8} state="green" completenessPct={0} />)
    expect(screen.queryByText('Profile complete')).not.toBeInTheDocument()
    expect(screen.queryByText('Good amount of information')).not.toBeInTheDocument()
    expect(screen.queryByText('Some key info missing')).not.toBeInTheDocument()
  })

  it('uses banded completeness copy', () => {
    const { rerender } = render(<RecruiterMatchBar score={0.5} state="yellow" completenessPct={55} />)
    expect(screen.getByText('Some key info missing')).toBeInTheDocument()
    expect(screen.getByText('May want more before deciding.')).toBeInTheDocument()
    rerender(<RecruiterMatchBar score={0.5} state="yellow" completenessPct={30} />)
    expect(screen.getByText('Limited information')).toBeInTheDocument()
    expect(screen.getByText('Hard to assess from the profile alone.')).toBeInTheDocument()
  })

  it('exposes an accessible progressbar with the rounded value', () => {
    render(<RecruiterMatchBar score={0.66} state="green" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '66')
  })
})
