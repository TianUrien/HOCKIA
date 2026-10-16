import { describe, expect, it } from 'vitest'
import type { Vacancy, Profile } from '@/lib/supabase'
import { buildRails, isNewRole, isRelevantForViewer, pickFeatured, roleStatus } from '@/lib/opportunityRails'

const now = new Date('2026-10-16T12:00:00Z')
const iso = (daysFromNow: number) => new Date(now.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
let n = 0
const vac = (p: Partial<Vacancy> = {}): Vacancy => ({
  id: `v${++n}`, club_id: 'c1', title: 'Role', opportunity_type: 'player', position: 'defender', gender: 'Women', status: 'open',
  created_at: new Date(now.getTime() - 2 * 86_400_000).toISOString(), application_deadline: null, benefits: [], compensation: null,
  eu_passport_required: false, location_city: 'Rome', location_country: 'Italy', requirements: [], custom_benefits: [], specialist_skills_wanted: [],
  ...p,
} as unknown as Vacancy)
const player = { id: 'p1', role: 'player', position: 'defender', gender: 'female', nationality_country_id: null, nationality2_country_id: null } as unknown as Profile
const ctx = { profile: player, countries: [] }

describe('roleStatus', () => {
  it('closing wins over new; ≤ 5 days is amber; later deadlines show the day', () => {
    expect(roleStatus(vac({ application_deadline: iso(9) }), now)).toEqual({ label: 'Closes in 9 days', tone: 'ink' })
    expect(roleStatus(vac({ application_deadline: iso(3) }), now)).toEqual({ label: 'Closes in 3 days', tone: 'amber' })
    expect(roleStatus(vac({ application_deadline: iso(1) }), now)?.label).toBe('Closes in 1 day')
    expect(roleStatus(vac({ application_deadline: iso(40) }), now)?.label).toMatch(/^Closes \d{1,2} \w{3}$/)
    expect(roleStatus(vac(), now)).toEqual({ label: 'New', tone: 'brand' })
    expect(roleStatus(vac({ created_at: new Date(now.getTime() - 20 * 86_400_000).toISOString() }), now)).toBeNull()
    expect(isNewRole(vac(), now)).toBe(true)
  })
})

describe('relevance', () => {
  it('player: eligible + same position; another position or a coach role is not for them', () => {
    expect(isRelevantForViewer(vac(), ctx)).toBe(true)
    expect(isRelevantForViewer(vac({ position: 'goalkeeper' }), ctx)).toBe(false)
    expect(isRelevantForViewer(vac({ opportunity_type: 'coach', position: null }), ctx)).toBe(false)
    expect(isRelevantForViewer(vac({ gender: 'Men' }), ctx)).toBe(false)
  })
  it('guest: nothing is "for you"', () => {
    expect(isRelevantForViewer(vac(), { profile: null, countries: [] })).toBe(false)
  })
})

describe('pickFeatured', () => {
  it('newest relevant role first, else soonest deadline, else newest', () => {
    const older = vac({ created_at: new Date(now.getTime() - 5 * 86_400_000).toISOString() })
    const newer = vac()
    const other = vac({ position: 'goalkeeper', application_deadline: iso(2), created_at: now.toISOString() })
    expect(pickFeatured([older, other, newer], ctx, now)?.id).toBe(newer.id)
    expect(pickFeatured([older, other, newer], { profile: null, countries: [] }, now)?.id).toBe(other.id)
    expect(pickFeatured([older, newer], { profile: null, countries: [] }, now)?.id).toBe(newer.id)
    expect(pickFeatured([], ctx, now)).toBeNull()
  })
})

describe('buildRails', () => {
  it('a rail needs two cards; the featured role is left out of the rails', () => {
    const a = vac(); const b = vac(); const c = vac({ position: 'goalkeeper' })
    const rails = buildRails([a, b, c], ctx, a.id, now)
    expect(rails.map((r) => r.key)).toEqual([]) // only b is "for you" after removing the featured a
    const rails2 = buildRails([a, b, c], ctx, null, now)
    expect(rails2.map((r) => r.key)).toEqual(['for-you'])
    expect(rails2[0].roles.map((v) => v.id)).toEqual([a.id, b.id])
  })
  it('paid with housing and closing soon rails', () => {
    const paid = (p: Partial<Vacancy> = {}) => vac({ compensation: 'Paid', benefits: ['housing'], position: 'goalkeeper', ...p })
    const list = [paid(), paid(), vac({ position: 'goalkeeper', application_deadline: iso(3) }), vac({ position: 'goalkeeper', application_deadline: iso(10) }), vac({ position: 'goalkeeper', application_deadline: iso(30) })]
    const rails = buildRails(list, { profile: null, countries: [] }, null, now)
    expect(rails.map((r) => r.key)).toEqual(['paid-housing', 'closing-soon'])
    expect(rails[1].roles).toHaveLength(2)
    expect(rails[1].roles[0].application_deadline).toBe(iso(3))
  })
})
