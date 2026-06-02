/**
 * Coach Fit math (Phase 2C) — specialization-only v1.
 *
 * Contract:
 *   - NOT_APPLICABLE unless: viewer is club/coach, candidate is a coach,
 *     scope seeks a coach (targetRole === 'coach'), AND a specific coaching
 *     role is sought (targetSpecialization set).
 *   - Specialization is the dominant signal (0.8); category is a tiebreak
 *     (0.2). Vocabularies are aligned by stripping a trailing '_coach'.
 *   - State thresholds match Club Fit: green ≥ 0.66, yellow ≥ 0.40.
 */

import { describe, expect, it } from 'vitest'
import { computeCoachFit, coachFitStateLabel } from '@/lib/coachFit'

const club = {
  role: 'club' as const,
  womens_league_division: null,
  mens_league_division: null,
  current_world_club_id: 'club-uuid',
}

const headCoach = {
  id: 'coach-1',
  role: 'coach' as const,
  coach_specialization: 'head_coach',
  coaching_categories: ['adult_men'],
}

const COACH_SCOPE = { targetRole: 'coach', targetSpecialization: 'head_coach', overrideTarget: 'Men' as const }

describe('computeCoachFit', () => {
  it('NOT_APPLICABLE when viewer is null', () => {
    expect(computeCoachFit(null, headCoach, COACH_SCOPE).isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when candidate is not a coach', () => {
    const player = { ...headCoach, role: 'player' as const }
    expect(computeCoachFit(club, player, COACH_SCOPE).isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when the scope does not seek a coach', () => {
    expect(computeCoachFit(club, headCoach, { ...COACH_SCOPE, targetRole: 'player' }).isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when no specific coaching role is sought', () => {
    expect(computeCoachFit(club, headCoach, { ...COACH_SCOPE, targetSpecialization: null }).isApplicable).toBe(false)
  })

  it('specialization match + category match → strong (green, 1.0)', () => {
    const r = computeCoachFit(club, headCoach, COACH_SCOPE)
    expect(r.isApplicable).toBe(true)
    expect(r.components.specialization_match).toBe(1)
    expect(r.components.category_match).toBe(1)
    expect(r.score).toBeCloseTo(1.0, 5)
    expect(r.state).toBe('green')
  })

  it('specialization match, category miss → still strong (green, 0.8)', () => {
    // Coach coaches women's teams, but scope targets men's → category miss.
    const womensHeadCoach = { ...headCoach, coaching_categories: ['adult_women'] }
    const r = computeCoachFit(club, womensHeadCoach, COACH_SCOPE)
    expect(r.components.specialization_match).toBe(1)
    expect(r.components.category_match).toBe(0)
    expect(r.score).toBeCloseTo(0.8, 5)
    expect(r.state).toBe('green')
  })

  it('specialization miss, category match → low (grey, 0.2)', () => {
    const assistant = { ...headCoach, coach_specialization: 'assistant_coach' }
    const r = computeCoachFit(club, assistant, COACH_SCOPE)
    expect(r.components.specialization_match).toBe(0)
    expect(r.components.category_match).toBe(1)
    expect(r.score).toBeCloseTo(0.2, 5)
    expect(r.state).toBe('grey')
  })

  it('a head coach outranks an assistant coach for a head-coach scope', () => {
    const head = computeCoachFit(club, headCoach, COACH_SCOPE)
    const assistant = computeCoachFit(club, { ...headCoach, coach_specialization: 'assistant_coach' }, COACH_SCOPE)
    expect(head.score).toBeGreaterThan(assistant.score)
  })

  it("aligns vocabularies: profile 'other' matches sought 'other_coach'", () => {
    const otherCoach = { ...headCoach, coach_specialization: 'other' }
    const r = computeCoachFit(club, otherCoach, { ...COACH_SCOPE, targetSpecialization: 'other_coach' })
    expect(r.components.specialization_match).toBe(1)
  })

  it('case-insensitive specialization comparison', () => {
    const r = computeCoachFit(club, { ...headCoach, coach_specialization: 'HEAD_COACH' }, COACH_SCOPE)
    expect(r.components.specialization_match).toBe(1)
  })

  it('coach with no specialization on file → no match, applicable, grey', () => {
    const r = computeCoachFit(club, { ...headCoach, coach_specialization: null }, COACH_SCOPE)
    expect(r.isApplicable).toBe(true)
    expect(r.components.specialization_match).toBe(0)
    expect(r.state).toBe('grey')
  })

  it('coach viewer (not just club) can produce a coach-fit result', () => {
    const coachViewer = { ...club, role: 'coach' as const }
    expect(computeCoachFit(coachViewer, headCoach, COACH_SCOPE).isApplicable).toBe(true)
  })

  it('open-to-any coaching categories count as a category match', () => {
    const openCoach = { ...headCoach, coaching_categories: ['any'] }
    const r = computeCoachFit(club, openCoach, COACH_SCOPE)
    expect(r.components.category_match).toBe(1)
  })

  it('state labels use the shared respectful vocabulary', () => {
    expect(coachFitStateLabel('green')).toBe('Strong fit')
    expect(coachFitStateLabel('yellow')).toBe('Possible fit')
    expect(coachFitStateLabel('grey')).toBe('Lower fit')
  })
})
