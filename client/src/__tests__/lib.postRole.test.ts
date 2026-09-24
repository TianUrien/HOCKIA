import { describe, it, expect } from 'vitest'
import {
  defaultTitle, draftFromRow, draftToRow, emptyDraft, hardnessFootnote, locationFromClub, normalizeDuration,
  playerChecklist, recruitingTarget, startLabel, stepProblem, type PostRoleDraft,
} from '@/lib/postRole'
import type { Vacancy } from '@/lib/supabase'

// Post a role (Figma 04 Club 330:318 / 330:431 / 330:596, DEV NOTEs 330:769 / 330:774 / 330:781).
const base = (over: Partial<PostRoleDraft> = {}): PostRoleDraft => ({
  ...emptyDraft({ baseLocation: 'Kilkenny, Ireland', countryName: 'Ireland' }),
  position: 'midfielder', gender: 'Men', ...over,
})

describe('Post a role · mapping', () => {
  it('prefills Where from the club profile', () => {
    expect(locationFromClub({ baseLocation: 'Kilkenny, Ireland', countryName: 'Ireland' })).toEqual({ city: 'Kilkenny', country: 'Ireland' })
    expect(locationFromClub({ baseLocation: 'Kilkenny', countryName: 'Ireland' })).toEqual({ city: 'Kilkenny', country: 'Ireland' })
    expect(locationFromClub({ baseLocation: null, countryName: null })).toEqual({ city: '', country: '' })
  })

  it('writes every field onto the opportunities row', () => {
    const row = draftToRow(base({
      positionRequired: true, level: 'high_performance', levelRequired: true, skills: ['drag_flicker', 'sweeper_keeper'],
      startDate: '2026-09-01', duration: '7 months', pay: 'paid', payRequired: true, benefits: ['housing', 'flights'],
      euPassport: true, description: '  We train Tuesdays.  ', title: '',
    }), 'club-1', 'open')
    expect(row).toMatchObject({
      club_id: 'club-1', opportunity_type: 'player', position: 'midfielder', position_required: true, gender: 'Men',
      title: 'Men\'s midfielder', level_sought: 'high_performance', level_required: true,
      specialist_skills_wanted: ['drag_flicker'], start_date: '2026-09-01', duration_text: '7 months',
      location_city: 'Kilkenny', location_country: 'Ireland', compensation: 'paid', compensation_required: true,
      benefits: ['housing', 'flights'], eu_passport_required: true, description: 'We train Tuesdays.', status: 'open',
    })
  })

  it('clears player-only fields on a coach role', () => {
    const row = draftToRow(base({ type: 'coach', position: 'head_coach', positionRequired: true, payRequired: true, pay: 'paid', skills: ['drag_flicker'] }), 'c', 'draft')
    expect(row).toMatchObject({ gender: null, position_required: false, compensation_required: false, specialist_skills_wanted: [], title: 'Head coach', status: 'draft' })
  })

  it('never saves a must-have with nothing chosen', () => {
    const row = draftToRow(base({ levelRequired: true, level: null, skillsRequired: true, skills: [] }), 'c', 'draft')
    expect(row.level_required).toBe(false)
    expect(row.specialists_required).toBe(false)
  })

  it('cleans legacy duration text for the Length picker', () => {
    expect(normalizeDuration('7')).toBe('7 months')
    expect(normalizeDuration('3 month')).toBe('3 months')
    expect(normalizeDuration('Permanent ')).toBe('Permanent')
    expect(normalizeDuration('full season')).toBe('Full season')
    expect(normalizeDuration(null)).toBeNull()
  })

  it('round-trips a saved draft', () => {
    const row = draftToRow(base({ duration: '12 months', pay: 'either', benefits: ['job'] }), 'c', 'draft')
    const back = draftFromRow({ ...(row as unknown as Vacancy), id: 'd1' })
    expect(back).toMatchObject({ id: 'd1', position: 'midfielder', gender: 'Men', duration: '12 months', pay: 'either', benefits: ['job'], city: 'Kilkenny' })
  })
})

describe('Post a role · copy and checks', () => {
  it('asks for position and team on step 1, and a place on step 2', () => {
    expect(stepProblem(base({ position: null }), 1)).toBe('Choose a position.')
    expect(stepProblem(base({ gender: null }), 1)).toBe('Choose the team.')
    expect(stepProblem(base(), 1)).toBeNull()
    expect(stepProblem(base({ city: '' }), 2)).toBe('Add where the role is.')
    expect(stepProblem(base({ type: 'coach', position: 'head_coach', gender: null }), 1)).toBeNull()
  })

  it('ticks what players ask first, with no score', () => {
    const items = playerChecklist(base({ startDate: '2026-09-01', duration: '7 months', pay: 'paid', benefits: ['housing'] }))
    expect(items.map((i) => i.ok)).toEqual([true, true, false, false])
  })

  it('writes the footnote from the hardness pills', () => {
    expect(hardnessFootnote(base({ positionRequired: true }))).toBe('Must have: Midfielder. Always required: Men\'s team. Everything else ranks players, it doesn’t block them.')
    expect(hardnessFootnote(base({ positionRequired: false, euPassport: true }))).toBe('Always required: Men\'s team, EU passport. Everything else ranks players, it doesn’t block them.')
  })

  it('maps the team to the Find players target', () => {
    expect(recruitingTarget('Boys')).toBe('Men')
    expect(recruitingTarget('Girls')).toBe('Women')
    expect(recruitingTarget('Mixed')).toBe('Mixed')
    expect(recruitingTarget(null)).toBeNull()
  })

  it('labels the start date like the role card', () => {
    expect(startLabel('2026-09-01', new Date('2026-06-01'))).toBe('Sep 1')
    expect(startLabel('2027-01-15', new Date('2026-06-01'))).toBe('Jan 15, 2027')
    expect(defaultTitle({ type: 'player', position: 'forward', gender: 'Women' })).toBe('Women\'s forward')
  })
})
