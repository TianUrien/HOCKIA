import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defaultFilters } from '@/components/community/communityFilters'
import {
  effectiveCommunitySort,
  evidenceFilterActive,
  getActiveFilterChips,
} from '@/lib/communityActiveFilters'
import { isRecruitingViewer, recruitingScopedRole } from '@/lib/recruiterAccess'

/**
 * Founder 2026-09-26: Community "sort by evidence" and "Enough evidence+"
 * are for clubs and recruiting coaches only. Everyone else: not offered, and
 * state carrying them falls back to the default sort / no filter.
 */
const VIEWERS = {
  club: { role: 'club' },
  recruitingCoach: { role: 'coach', coach_recruits_for_team: true },
  candidateCoach: { role: 'coach', coach_recruits_for_team: false },
  player: { role: 'player' },
  brand: { role: 'brand' },
  umpire: { role: 'umpire' },
  anon: null,
} as const

describe('Community evidence sort/filter gate', () => {
  it('recruiters keep the evidence sort and filter', () => {
    for (const v of [VIEWERS.club, VIEWERS.recruitingCoach]) {
      const can = isRecruitingViewer(v)
      expect(can).toBe(true)
      expect(effectiveCommunitySort('evidence', can)).toBe('evidence')
      expect(evidenceFilterActive({ evidenceEnoughOnly: true }, can)).toBe(true)
    }
  })

  it('everyone else falls back to newest / no filter', () => {
    for (const v of [VIEWERS.candidateCoach, VIEWERS.player, VIEWERS.brand, VIEWERS.umpire, VIEWERS.anon]) {
      const can = isRecruitingViewer(v)
      expect(can).toBe(false)
      expect(effectiveCommunitySort('evidence', can)).toBe('newest')
      expect(evidenceFilterActive({ evidenceEnoughOnly: true }, can)).toBe(false)
    }
  })

  it('non-evidence sorts are untouched for everyone', () => {
    expect(effectiveCommunitySort('completeness', false)).toBe('completeness')
    expect(effectiveCommunitySort('newest', false)).toBe('newest')
  })

  it('no "Enough evidence+" chip for a non-recruiter even if the state carries it', () => {
    const filters = { ...defaultFilters('player'), evidenceEnoughOnly: true }
    const noop = () => {}
    expect(getActiveFilterChips(filters, [], noop).find((c) => c.id === 'evidence')).toBeUndefined()
    expect(getActiveFilterChips(filters, [], noop, { canUseEvidence: false }).find((c) => c.id === 'evidence')).toBeUndefined()
  })

  it('the grid and the page apply the gate (option hidden, state reset)', () => {
    const grid = readFileSync(resolve(__dirname, '../components/community/PeopleListView.tsx'), 'utf-8')
    expect(grid).toMatch(/const sort = effectiveCommunitySort\(requestedSort, canUseEvidence\)/)
    expect(grid).toMatch(/if \(evidenceOnly\) \{/)
    expect(grid).not.toMatch(/if \(filters\.evidenceEnoughOnly\)/)
    const page = readFileSync(resolve(__dirname, '../pages/CommunityPage.tsx'), 'utf-8')
    expect(page).toMatch(/canUseEvidence && \(filters\.role === 'player' \|\| filters\.role === 'coach'\) && \(\s*<option value="evidence">/)
    expect(page).toMatch(/updateFilter\('evidenceEnoughOnly', false\)/)
  })
})

describe('Community scope reshaping follows the recruiter rule', () => {
  it('clubs and recruiting coaches get their scope role', () => {
    expect(recruitingScopedRole(VIEWERS.club, 'player')).toBe('player')
    expect(recruitingScopedRole(VIEWERS.recruitingCoach, 'coach')).toBe('coach')
    expect(recruitingScopedRole(VIEWERS.club, 'custom')).toBeNull()
    expect(recruitingScopedRole(VIEWERS.club, null)).toBeNull()
  })

  it('a candidate coach behaves like a player: no reshaping even with a scope row', () => {
    for (const v of [VIEWERS.candidateCoach, VIEWERS.player, VIEWERS.brand, VIEWERS.umpire, VIEWERS.anon]) {
      expect(recruitingScopedRole(v, 'player')).toBeNull()
      expect(recruitingScopedRole(v, 'coach')).toBeNull()
    }
  })

  it('CommunityPage derives recruiter + scope from the shared rule, not role === coach', () => {
    const page = readFileSync(resolve(__dirname, '../pages/CommunityPage.tsx'), 'utf-8')
    expect(page).toMatch(/const isRecruiterViewer = isRecruitingViewer\(viewerProfile\)/)
    expect(page).toMatch(/const scopedRole = recruitingScopedRole\(viewerProfile, activeRecruitingRole\)/)
    expect(page).not.toMatch(/viewerProfile\?\.role === 'coach'/)
  })
})
