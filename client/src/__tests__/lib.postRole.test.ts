import { describe, it, expect } from 'vitest'
import {
  defaultTitle, draftFromRow, draftToRow, emptyDraft, hardnessFootnote, locationFromClub, normalizeDuration,
  playerChecklist, recruitingTarget, replyWindowLine, rolePostedCopy, startLabel, stepProblem, switchRoleType, teamsFor,
  COACH_TEAMS, COACH_TEAM_HINT, TEAMS, type PostRoleDraft,
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
    expect(row).toMatchObject({ gender: 'Men', position_required: false, compensation_required: false, specialist_skills_wanted: [], title: 'Men\'s head coach', status: 'draft' })
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
    expect(stepProblem(base({ type: 'coach', position: 'head_coach', gender: null }), 1)).toBe('Choose the team.')
    expect(stepProblem(base({ type: 'coach', position: 'head_coach', gender: 'Girls' }), 1)).toBeNull()
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

// Founder ruling 2026-09-25 (C) / Figma D1.6: no youth PLAYER roles; the DB
// rejects them (CHECK opportunities_player_role_not_youth).
describe('Post a role · no youth player roles', () => {
  it('offers only adult teams', () => {
    expect(TEAMS.map((t) => t.value)).toEqual(['Men', 'Women', 'Mixed'])
  })

  it('blocks Continue on a youth team and never writes one for a player role', () => {
    expect(stepProblem(base({ gender: 'Boys' }), 1)).toBe('Choose the team.')
    expect(stepProblem(base({ gender: 'Girls' }), 3)).toBe('Choose the team.')
    expect(draftToRow(base({ gender: 'Girls' }), 'c', 'draft').gender).toBeNull()
  })

  it('opens a legacy youth player role with no team; coach roles keep theirs', () => {
    const row = { ...(draftToRow(base(), 'c', 'draft') as unknown as Vacancy), id: 'd1' }
    expect(draftFromRow({ ...row, gender: 'Boys' }).gender).toBeNull()
    expect(draftFromRow({ ...row, gender: 'Women' }).gender).toBe('Women')
    expect(draftFromRow({ ...row, opportunity_type: 'coach', gender: 'Girls' }).gender).toBe('Girls')
  })
})

// Founder ruling 2026-09-26: coach roles pick a team like player roles, Boys/Girls included.
describe('Post a role · coach role team', () => {
  const coach = (over: Partial<PostRoleDraft> = {}) => base({ type: 'coach', position: 'head_coach', ...over })

  it('offers Boys and Girls on coach roles only', () => {
    expect(COACH_TEAMS.map((t) => t.value)).toEqual(['Men', 'Women', 'Mixed', 'Boys', 'Girls'])
    expect(teamsFor('coach')).toBe(COACH_TEAMS)
    expect(teamsFor('player')).toBe(TEAMS)
    expect(COACH_TEAM_HINT).toBe('Boys and Girls are for coach and staff roles only.')
  })

  it('writes and reads back a coach role team, Boys/Girls included', () => {
    const row = draftToRow(coach({ gender: 'Girls', title: '' }), 'c', 'open')
    expect(row).toMatchObject({ opportunity_type: 'coach', gender: 'Girls', title: 'Girls head coach' })
    expect(draftFromRow({ ...(row as unknown as Vacancy), id: 'c1' }).gender).toBe('Girls')
  })

  it('asks a legacy coach draft without a team for one', () => {
    const legacy = draftFromRow({ ...(draftToRow(coach(), 'c', 'draft') as unknown as Vacancy), gender: null, id: 'c2' })
    expect(legacy.gender).toBeNull()
    expect(stepProblem(legacy, 1)).toBe('Choose the team.')
    expect(stepProblem(legacy, 3)).toBe('Choose the team.')
  })

  it('keeps the team when switching type, clearing Boys/Girls on the way to Player', () => {
    expect(switchRoleType(base({ gender: 'Women' }), 'coach')).toMatchObject({ type: 'coach', gender: 'Women', position: null })
    expect(switchRoleType(coach({ gender: 'Mixed' }), 'player')).toMatchObject({ type: 'player', gender: 'Mixed', position: null })
    expect(switchRoleType(coach({ gender: 'Boys' }), 'player')).toMatchObject({ type: 'player', gender: null })
    const same = base()
    expect(switchRoleType(same, 'player')).toBe(same)
  })

  it('never lists a coach role team as a blocker, and speaks of coaches', () => {
    expect(hardnessFootnote(coach({ gender: 'Girls' }))).toBe('Nothing blocks coaches; everything here ranks them.')
    expect(hardnessFootnote(coach({ gender: 'Girls', euPassport: true }))).toBe('Always required: EU passport. Everything else ranks coaches, it doesn’t block them.')
  })
})

describe('Role posted (D1.26)', () => {
  it('titles the screen by position and points Find at the right pool', () => {
    expect(rolePostedCopy({ type: 'player', position: 'midfielder' })).toMatchObject({
      title: 'Midfielder is live', findLabel: 'Find players for this role', findPath: '/community/players', pushTitle: 'Know when players apply',
    })
    expect(rolePostedCopy({ type: 'coach', position: 'head_coach' })).toMatchObject({
      title: 'Head coach is live', findLabel: 'Find coaches for this role', findPath: '/community/coaches',
    })
    expect(rolePostedCopy({ type: 'player', position: 'midfielder' }).body).toMatch(/^Players who fit can find it in Opportunities now\./)
    expect(rolePostedCopy({ type: 'coach', position: 'head_coach' }).body).toMatch(/^Coaches who fit/)
  })

  it('uses the configured reply window', () => {
    expect(replyWindowLine(14)).toBe('Answer each applicant within 14 days. After that, their application closes on its own.')
    expect(replyWindowLine(21)).toMatch(/within 21 days/)
  })
})
