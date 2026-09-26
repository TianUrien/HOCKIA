/**
 * Player-rule leaks (Phase 1 · step 4) — the Proven (evidence) and
 * Interested lenses are recruiter-only: clubs and coaches who recruit for a
 * team. A coach who is only looking for a role (candidate coach) or a
 * player never gets an applicable result, so ProvenSignal / EvidenceSignal /
 * InterestSignal render nothing for them (ScoutingCard, MemberTile).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

type Viewer = { profile: { id: string; role: string; coach_recruits_for_team?: boolean } | null }
const authState: Viewer = { profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getClubLevelBand: () => null }))
vi.mock('@/hooks/useRecruitingContext', () => ({
  useActiveRecruitingTargetRole: () => 'player',
  useActiveRecruitingTargetLocation: () => 'Netherlands',
  useActiveRecruitingTargetStartDate: () => null,
  useActiveRecruitingTargetLevel: () => 'elite',
  useActiveRecruitingTargetCompensation: () => null,
  useActiveRecruitingMustHaves: () => ({}),
}))
// Isolate the viewer gate: pretend the scorer always has something to say.
vi.mock('@/lib/interestFit', () => ({
  computeInterest: () => ({ isApplicable: true, level: 'high', score: 80, reasons: ['x'], positives: [], caveats: [] }),
}))

import { useEvidence } from '@/hooks/useEvidence'
import { useInterest } from '@/hooks/useInterest'

// A candidate with strong evidence (match video + references + verified + club).
const candidate = {
  role: 'player',
  highlight_video_url: 'https://example.test/v',
  full_game_video_count: 2,
  accepted_reference_count: 3,
  is_verified: true,
  current_world_club_id: 'wc-1',
}

const setViewer = (role: string | null, recruits = false) => {
  authState.profile = role ? { id: 'viewer-1', role, coach_recruits_for_team: recruits } : null
}

const cases: Array<[string, string | null, boolean, boolean]> = [
  ['player', 'player', false, false],
  ['candidate coach', 'coach', false, false],
  ['umpire', 'umpire', false, false],
  ['signed-out', null, false, false],
  ['club', 'club', false, true],
  ['recruiting coach', 'coach', true, true],
]

describe('useEvidence (Proven lens) — recruiter-only', () => {
  it.each(cases)('%s viewer → applicable=%s', (_label, role, recruits, expected) => {
    setViewer(role, recruits)
    const { result } = renderHook(() => useEvidence(candidate))
    expect(result.current.isApplicable).toBe(expected)
  })
})

describe('useInterest (Interested lens) — recruiter-only', () => {
  it.each(cases)('%s viewer → applicable=%s', (_label, role, recruits, expected) => {
    setViewer(role, recruits)
    const { result } = renderHook(() => useInterest({ ...candidate, playing_category: 'adult_women' }))
    expect(result.current.isApplicable).toBe(expected)
  })
})
