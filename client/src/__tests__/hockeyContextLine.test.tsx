/**
 * HockeyContextLine — render contract tests.
 *
 * Spec G.2: "One line, fact-only: {currentClub} · {currentCompetition.name}
 * · {position}. Falls back to 'Not added yet' per missing field
 * (italic, muted)."
 *
 * What we lock in here:
 *   - 3 segments with middle-dot separators
 *   - Each missing/blank segment becomes "Not added yet" individually
 *     (the dot separators stay; we don't collapse them — see the
 *     component's own comment for why)
 *   - Whitespace-only values are treated as missing
 *   - All three present → no fallback anywhere
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import HockeyContextLine from '@/components/recruiting/HockeyContextLine'

describe('HockeyContextLine', () => {
  it('renders all three segments when every field is populated', () => {
    render(
      <HockeyContextLine
        clubName="CASI"
        competitionName="Torneo Metropolitano A"
        position="Forward"
      />,
    )
    expect(screen.getByText('CASI')).toBeInTheDocument()
    expect(screen.getByText('Torneo Metropolitano A')).toBeInTheDocument()
    expect(screen.getByText('Forward')).toBeInTheDocument()
    expect(screen.queryByText(/not added yet/i)).not.toBeInTheDocument()
  })

  it('falls back to "Not added yet" per missing segment', () => {
    render(
      <HockeyContextLine
        clubName={null}
        competitionName="Hoofdklasse Heren"
        position={null}
      />,
    )
    expect(screen.getByText('Hoofdklasse Heren')).toBeInTheDocument()
    // Two missing segments → two fallback strings render
    expect(screen.getAllByText('Not added yet')).toHaveLength(2)
  })

  it('treats whitespace-only values as missing', () => {
    render(
      <HockeyContextLine
        clubName="   "
        competitionName="  "
        position=""
      />,
    )
    expect(screen.getAllByText('Not added yet')).toHaveLength(3)
  })

  it('shows three "Not added yet" when every field is absent', () => {
    render(<HockeyContextLine />)
    expect(screen.getAllByText('Not added yet')).toHaveLength(3)
  })

  it('renders the fallback as italic + muted (visual contract)', () => {
    render(
      <HockeyContextLine
        clubName={null}
        competitionName="Hoofdklasse Heren"
        position="Defender"
      />,
    )
    const fallback = screen.getByText('Not added yet')
    expect(fallback.className).toMatch(/italic/)
    expect(fallback.className).toMatch(/text-gray-400/)
  })

  it('preserves middle-dot separators between segments', () => {
    const { container } = render(
      <HockeyContextLine clubName="CASI" competitionName="Metro A" position="Forward" />,
    )
    // Each separator is a span containing the · glyph
    const separators = within(container).getAllByText('·')
    expect(separators).toHaveLength(2)
  })
})
