/**
 * Evidence checklist (Phase 2) — data contract + expandable UI.
 *
 * Pins:
 *   - evidenceChecklist enumerates present AND missing signals (the value
 *     over the positives-only item row).
 *   - coaches drop the video rows (no upload surface) — never marked
 *     "missing" an artifact they can't provide.
 *   - non-person roles get an empty checklist.
 *   - EvidenceSignal pill expands into a ✓/✗ popover on tap.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { evidenceChecklist, type EvidenceResult } from '@/lib/evidence'
import EvidenceSignal from '@/components/recruiting/EvidenceSignal'

afterEach(cleanup)

describe('evidenceChecklist', () => {
  it('marks present and missing signals for a player', () => {
    const rows = evidenceChecklist({
      role: 'player',
      highlight_video_url: 'https://x',
      full_game_video_count: 0,
      accepted_reference_count: 2,
      current_world_club_id: null,
      current_club: 'CASI',
      career_entry_count: 0,
      open_to_play: true,
      competition_level_band: 4,
    })
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.highlight.present).toBe(true)
    expect(byKey.full_match.present).toBe(false)
    expect(byKey.references.present).toBe(true)
    expect(byKey.references.label).toBe('2 references')
    expect(byKey.club.present).toBe(true) // current_club text counts
    expect(byKey.league.present).toBe(true) // band resolved
    expect(byKey.career.present).toBe(false)
    expect(byKey.open.present).toBe(true)
  })

  it('drops video rows for coaches and uses "Open to coach"', () => {
    const rows = evidenceChecklist({ role: 'coach', accepted_reference_count: 0, open_to_coach: true })
    const keys = rows.map((r) => r.key)
    expect(keys).not.toContain('full_match')
    expect(keys).not.toContain('highlight')
    expect(rows.find((r) => r.key === 'open')?.label).toBe('Open to coach')
  })

  it('returns an empty checklist for non-person roles', () => {
    expect(evidenceChecklist({ role: 'club' })).toEqual([])
    expect(evidenceChecklist(null)).toEqual([])
  })
})

describe('EvidenceSignal', () => {
  const result: EvidenceResult = {
    isApplicable: true,
    level: 'moderate',
    score: 0.5,
    items: [],
    reasons: [],
  }

  it('expands the pill into a ✓/✗ checklist on tap', async () => {
    const user = userEvent.setup()
    render(
      <EvidenceSignal
        result={result}
        checklist={[
          { key: 'highlight', label: 'Highlight video', present: false },
          { key: 'references', label: '2 references', present: true },
        ]}
      />,
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Evidence: Enough evidence/i }))
    const popover = await screen.findByRole('tooltip')
    expect(within(popover).getByText('Highlight video')).toBeInTheDocument()
    expect(within(popover).getByText('2 references')).toBeInTheDocument()
  })

  it('is not expandable when the checklist is empty', () => {
    render(<EvidenceSignal result={result} checklist={[]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing when evidence is not applicable', () => {
    const { container } = render(
      <EvidenceSignal result={{ ...result, isApplicable: false }} checklist={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
