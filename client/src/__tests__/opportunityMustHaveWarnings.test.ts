/**
 * Phase 3f — candidate-facing must-have advisory (opportunityMustHaveWarnings).
 *
 * Contract:
 *   - Warns (candidate voice) on an EXPLICIT must-have mismatch; a BLANK
 *     candidate field never warns (honest-absence).
 *   - Player opportunities only; coach opps never warn.
 *   - LEVEL is intentionally not warned (needs proven-band resolution).
 *   - Warn-only — this is advisory; it does not affect eligibility.
 */

import { describe, expect, it } from 'vitest'
import { opportunityMustHaveWarnings } from '@/lib/opportunityEligibility'
import type { Vacancy, Profile } from '@/lib/supabase'

const COUNTRIES: Record<number, string> = { 30: 'Netherlands', 48: 'Argentina' }
const countryName = (id: number) => COUNTRIES[id]

const vacancy = (over: Record<string, unknown> = {}): Vacancy =>
  ({
    opportunity_type: 'player',
    position: null,
    position_required: false,
    level_sought: null,
    level_required: false,
    compensation: null,
    compensation_required: false,
    location_country: null,
    location_required: false,
    start_date: null,
    availability_required: false,
    specialist_skills_wanted: [],
    specialists_required: false,
    ...over,
  }) as unknown as Vacancy

const player = (over: Record<string, unknown> = {}): Profile =>
  ({
    position: null,
    secondary_position: null,
    specialist_skills: [],
    opportunity_preference: null,
    relocation_willingness: null,
    relocation_countries_open: null,
    relocation_countries_excluded: null,
    available_from: null,
    base_country_id: null,
    nationality_country_id: null,
    ...over,
  }) as unknown as Profile

describe('opportunityMustHaveWarnings', () => {
  it('no warnings when no must-haves are set', () => {
    expect(opportunityMustHaveWarnings(vacancy(), player({ position: 'midfielder' }), countryName)).toEqual([])
  })

  it('no warnings for a coach opportunity', () => {
    const v = vacancy({ opportunity_type: 'coach', position_required: true, position: 'goalkeeper' })
    expect(opportunityMustHaveWarnings(v, player({ position: 'midfielder' }), countryName)).toEqual([])
  })

  it('no warnings when there is no profile', () => {
    expect(opportunityMustHaveWarnings(vacancy({ position_required: true, position: 'goalkeeper' }), null, countryName)).toEqual([])
  })

  // ── Position ──
  it('warns on a required position the candidate explicitly does not play', () => {
    const v = vacancy({ position_required: true, position: 'goalkeeper' })
    const w = opportunityMustHaveWarnings(v, player({ position: 'midfielder' }), countryName)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/Goalkeeper/)
    expect(w[0]).toMatch(/Midfielder/)
  })

  it('does NOT warn on a required position when the candidate has none on file', () => {
    const v = vacancy({ position_required: true, position: 'goalkeeper' })
    expect(opportunityMustHaveWarnings(v, player({ position: null }), countryName)).toEqual([])
  })

  it('does NOT warn when the required position matches the secondary', () => {
    const v = vacancy({ position_required: true, position: 'goalkeeper' })
    expect(opportunityMustHaveWarnings(v, player({ position: 'midfielder', secondary_position: 'goalkeeper' }), countryName)).toEqual([])
  })

  // ── Specialists ──
  it('warns when a required specialism is missing but the candidate lists others', () => {
    const v = vacancy({ specialists_required: true, specialist_skills_wanted: ['drag_flicker'] })
    const w = opportunityMustHaveWarnings(v, player({ specialist_skills: ['penalty_corner'] }), countryName)
    expect(w).toHaveLength(1)
  })

  it('does NOT warn on required specialists when the candidate lists none', () => {
    const v = vacancy({ specialists_required: true, specialist_skills_wanted: ['drag_flicker'] })
    expect(opportunityMustHaveWarnings(v, player({ specialist_skills: [] }), countryName)).toEqual([])
  })

  // ── Compensation ──
  it('warns when comp is required-unpaid and the candidate wants paid', () => {
    const v = vacancy({ compensation_required: true, compensation: 'unpaid_development' })
    const w = opportunityMustHaveWarnings(v, player({ opportunity_preference: 'paid' }), countryName)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/paid/i)
  })

  it('does NOT warn on required comp when the candidate is open to either', () => {
    const v = vacancy({ compensation_required: true, compensation: 'unpaid_development' })
    expect(opportunityMustHaveWarnings(v, player({ opportunity_preference: 'either' }), countryName)).toEqual([])
  })

  // ── Location ──
  it('warns when location is required and the candidate excluded that country', () => {
    const v = vacancy({ location_required: true, location_country: 'Netherlands' })
    const w = opportunityMustHaveWarnings(v, player({ relocation_willingness: 'relocate', relocation_countries_excluded: [30] }), countryName)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/Netherlands/)
  })

  it('does NOT warn on required location when the candidate has no relocation data', () => {
    const v = vacancy({ location_required: true, location_country: 'Netherlands' })
    expect(opportunityMustHaveWarnings(v, player({}), countryName)).toEqual([])
  })

  // ── Availability ──
  it('warns when availability is required and the candidate is available after the start', () => {
    const v = vacancy({ availability_required: true, start_date: '2026-03-01' })
    const w = opportunityMustHaveWarnings(v, player({ available_from: '2026-09-01' }), countryName)
    expect(w).toHaveLength(1)
  })

  it('does NOT warn when the candidate is available before the start', () => {
    const v = vacancy({ availability_required: true, start_date: '2026-09-01' })
    expect(opportunityMustHaveWarnings(v, player({ available_from: '2026-01-01' }), countryName)).toEqual([])
  })

  // ── Level intentionally not warned ──
  it('does NOT warn on a level must-have (intentionally deferred to verdict/search)', () => {
    const v = vacancy({ level_required: true, level_sought: 'elite' })
    expect(opportunityMustHaveWarnings(v, player({ level_target: 'development' }), countryName)).toEqual([])
  })

  it('collects multiple warnings across criteria', () => {
    const v = vacancy({
      position_required: true,
      position: 'goalkeeper',
      availability_required: true,
      start_date: '2026-03-01',
    })
    const w = opportunityMustHaveWarnings(v, player({ position: 'forward', available_from: '2026-09-01' }), countryName)
    expect(w).toHaveLength(2)
  })
})
