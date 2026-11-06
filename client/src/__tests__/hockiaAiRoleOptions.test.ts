import { describe, expect, it } from 'vitest'
import { roleOptionsFor } from '@/lib/hockiaAi'

const labels = (p: Parameters<typeof roleOptionsFor>[0], role?: string) => roleOptionsFor(p, role)?.map((o) => o.label)

describe('roleOptionsFor (rebrand page 17, founder 2026-11-06)', () => {
  it('gives every role exactly three choices', () => {
    for (const role of ['player', 'coach', 'club', 'brand', 'umpire']) expect(roleOptionsFor({ role })).toHaveLength(3)
  })

  it('recruiters name the active opportunity; candidate coaches never get recruiter choices', () => {
    expect(labels({ role: 'club' }, 'Midfielder · Women')).toEqual(['Find available players for Midfielder · Women', 'Summarise my applicants', 'Draft a new opportunity'])
    expect(labels({ role: 'coach', coach_recruits_for_team: true })?.[0]).toBe('Find available players for my open opportunity')
    expect(labels({ role: 'coach' })).toEqual(['Find coaching opportunities for me', 'Check my profile against an opportunity', 'Prepare my application'])
  })

  it('what Hockia AI cannot answer from real data opens the screen instead', () => {
    const brand = roleOptionsFor({ role: 'brand' })!
    expect(brand.slice(1).map((o) => o.action)).toEqual([{ type: 'go', to: '/dashboard/offers' }, { type: 'go', to: '/dashboard/offers/new' }])
    expect(brand.slice(1).every((o) => o.eyebrow === 'OPEN')).toBe(true)
    expect(roleOptionsFor({ role: 'umpire' })![0].action).toEqual({ type: 'go', to: '/dashboard/profile?tab=officiating&add=match' })
  })

  it('the player fills the profile with the builder, and visitors get no role choices', () => {
    expect(roleOptionsFor({ role: 'player' })![2].action).toEqual({ type: 'builder' })
    expect(roleOptionsFor(null)).toBeNull()
  })
})
