/**
 * Evidence / "Proven" lens (Increment #1).
 *
 * Contract:
 *   - Only players/coaches with ≥1 evidence signal are applicable.
 *   - Only surfaces evidence that EXISTS (no discouraging empty state).
 *   - Video dominates; full match > highlight reel. References scale to a
 *     cap. Verified + provable level add confidence.
 *   - Tiers: strong ≥0.66, moderate ≥0.33, else limited.
 */

import { describe, expect, it } from 'vitest'
import { computeEvidence, evidenceLevelLabel } from '@/lib/evidence'

const player = (over: Record<string, unknown> = {}) => ({ role: 'player' as const, ...over })
const coach = (over: Record<string, unknown> = {}) => ({ role: 'coach' as const, ...over })

describe('computeEvidence', () => {
  it('NOT applicable for a candidate with no evidence at all', () => {
    expect(computeEvidence(player()).isApplicable).toBe(false)
  })

  it('NOT applicable for non player/coach roles even with signals', () => {
    const club = { role: 'club' as const, is_verified: true, current_world_club_id: 'wc-1' }
    expect(computeEvidence(club).isApplicable).toBe(false)
  })

  it('NOT applicable for null candidate', () => {
    expect(computeEvidence(null).isApplicable).toBe(false)
  })

  it('full match footage outweighs a highlight reel', () => {
    const match = computeEvidence(player({ full_game_video_count: 1 }))
    const reel = computeEvidence(player({ highlight_video_url: 'https://v/x' }))
    expect(match.score).toBeGreaterThan(reel.score)
    expect(match.items[0].label).toBe('Match video')
    expect(reel.items[0].label).toBe('Highlight reel')
  })

  it('does not double-count video (match footage supersedes highlight reel)', () => {
    const both = computeEvidence(player({ full_game_video_count: 2, highlight_video_url: 'https://v/x' }))
    const videoItems = both.items.filter((i) => i.key === 'video')
    expect(videoItems).toHaveLength(1)
    expect(videoItems[0].label).toBe('Match video')
  })

  it('references scale with count and cap out', () => {
    const one = computeEvidence(player({ accepted_reference_count: 1 }))
    const three = computeEvidence(player({ accepted_reference_count: 3 }))
    const ten = computeEvidence(player({ accepted_reference_count: 10 }))
    expect(three.score).toBeGreaterThan(one.score)
    expect(ten.score).toBeCloseTo(three.score, 5) // capped
    expect(one.items.find((i) => i.key === 'references')?.label).toBe('1 reference')
    expect(three.items.find((i) => i.key === 'references')?.label).toBe('3 references')
  })

  it('a full match + 3 references + verified + level reads as strong', () => {
    const r = computeEvidence(
      player({ full_game_video_count: 1, accepted_reference_count: 3, is_verified: true, current_world_club_id: 'wc-1' }),
    )
    expect(r.level).toBe('strong')
    expect(r.isApplicable).toBe(true)
    expect(r.items.map((i) => i.key)).toEqual(['video', 'references', 'verified', 'level'])
  })

  it('a single weak signal reads as limited', () => {
    const r = computeEvidence(player({ is_verified: true }))
    expect(r.isApplicable).toBe(true)
    expect(r.level).toBe('limited')
    expect(r.items).toHaveLength(1)
  })

  it('moderate sits between the thresholds', () => {
    // highlight reel (0.28) + 1 club level (0.15) = 0.43 → moderate
    const r = computeEvidence(player({ highlight_video_url: 'https://v/x', current_world_club_id: 'wc-1' }))
    expect(r.level).toBe('moderate')
  })

  it('applies to coaches too', () => {
    const coach = computeEvidence({ role: 'coach', accepted_reference_count: 2, is_verified: true })
    expect(coach.isApplicable).toBe(true)
  })

  it('score never exceeds 1', () => {
    const r = computeEvidence(
      player({ full_game_video_count: 9, accepted_reference_count: 99, is_verified: true, current_world_club_id: 'wc-1' }),
    )
    expect(r.score).toBeLessThanOrEqual(1)
  })

  it('level labels are stable', () => {
    expect(evidenceLevelLabel('strong')).toBe('Strong evidence')
    expect(evidenceLevelLabel('moderate')).toBe('Some evidence')
    expect(evidenceLevelLabel('limited')).toBe('Limited evidence')
  })

  // ── Coaches: no video model (no upload surface) ──────────────────
  it('coach evidence ignores video signals entirely', () => {
    // Even with player video fields set, a coach gets no video credit and
    // no video reason — they have no way to upload footage.
    const r = computeEvidence(coach({ full_game_video_count: 5, highlight_video_url: 'https://v/x' }))
    expect(r.isApplicable).toBe(false) // video is the only "signal" → nothing applies
    expect(r.items.some((i) => i.key === 'video')).toBe(false)
  })

  it('coach reaches strong on references + verified + club (no video needed)', () => {
    const r = computeEvidence(coach({ accepted_reference_count: 3, is_verified: true, current_world_club_id: 'wc-1' }))
    expect(r.level).toBe('strong') // 0.5 + 0.25 + 0.25 = 1.0
    expect(r.reasons.join(' ')).not.toMatch(/footage|video|reel/i)
    expect(r.reasons.join(' ')).toMatch(/Coaches at a listed club/i)
  })

  it('coach with no references/verification/club is limited — but never cites video', () => {
    const r = computeEvidence(coach({ current_world_club_id: 'wc-1' }))
    expect(r.isApplicable).toBe(true)
    expect(r.level).toBe('limited') // 0.25 only
    expect(r.reasons.join(' ')).not.toMatch(/video|footage|reel/i)
  })
})
