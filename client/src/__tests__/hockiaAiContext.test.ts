/**
 * Hockia AI context chip + first choices per role (one-sheet handoff
 * 2026-10-22; founder calls 2026-10-23: players "Your profile · <position>",
 * brands products and posts). Counts only from real reads, never guessed.
 */
import { describe, it, expect } from 'vitest'
import { aiContextFor, UMPIRE_ADD_APPOINTMENT_PATH } from '@/lib/hockiaAiContext'

const labels = (c: ReturnType<typeof aiContextFor>) => c?.choices.map((x) => `${x.eyebrow}: ${x.label}`)

describe('aiContextFor', () => {
  it('player: profile + position chip; Find roles · Check my profile · Fill my profile (builder)', () => {
    const c = aiContextFor({ role: 'player', position: 'midfielder' }, {})
    expect(c?.chip).toBe('Your profile · Midfielder')
    expect(labels(c)).toEqual(['DO IT FOR ME: Find roles that fit me', 'ASK: Check my profile against a role', 'DO IT FOR ME: Fill my profile from my files'])
    expect(c?.choices[2].action).toEqual({ type: 'builder' })
    expect(aiContextFor({ role: 'player', position: null }, {})?.chip).toBe('Your profile')
  })

  it('candidate coach: the open count only when the list provided it', () => {
    expect(aiContextFor({ role: 'coach' }, { coachingRolesOpen: 6 })?.chip).toBe('Coaching roles · 6 open')
    expect(aiContextFor({ role: 'coach' }, {})?.chip).toBe('Coaching roles')
    expect(labels(aiContextFor({ role: 'coach' }, {}))).toEqual(['DO IT FOR ME: Find coaching roles for me', 'ASK: Check my profile against a role', 'DO IT FOR ME: Prepare my application'])
  })

  it('club and recruiting coach: roles chip, the active role, applicants count, draft', () => {
    for (const viewer of [{ role: 'club' }, { role: 'coach', coach_recruits_for_team: true }]) {
      const c = aiContextFor(viewer, { openRoles: 2, pendingApplicants: 4 }, 'Left back')
      expect(c?.chip).toBe('Your roles · 2 open')
      expect(labels(c)).toEqual(['DO IT FOR ME: Find available players for Left back', 'ASK: Summarise my 4 applicants', 'DO IT FOR ME: Draft a new role'])
    }
    const one = aiContextFor({ role: 'club' }, { openRoles: 1, pendingApplicants: 1 })
    expect(one?.choices[1].label).toBe('Summarise my 1 applicant')
    expect(one?.choices[0].label).toBe('Find available players for my open role')
    // Unknown or zero: no invented number.
    expect(aiContextFor({ role: 'club' }, {})?.chip).toBe('Your roles')
    expect(aiContextFor({ role: 'club' }, { pendingApplicants: 0 })?.choices[1].label).toBe('Summarise my applicants')
  })

  it('brand: products chip; ambassadors · posts this month · write a post (no "offers")', () => {
    const c = aiContextFor({ role: 'brand' }, { products: 3 })
    expect(c?.chip).toBe('Your products · 3')
    expect(labels(c)).toEqual(['DO IT FOR ME: Find ambassador candidates in my countries', 'ASK: How did my posts do this month?', 'DO IT FOR ME: Write a post for members'])
    expect(JSON.stringify(c)).not.toMatch(/offer/i)
  })

  it('umpire: record chip; add an appointment opens the editor, then ask and learn', () => {
    const c = aiContextFor({ role: 'umpire' }, { appointments: 12 })
    expect(c?.chip).toBe('Your record · 12 appointments')
    expect(aiContextFor({ role: 'umpire' }, { appointments: 1 })?.chip).toBe('Your record · 1 appointment')
    expect(c?.choices[0].action).toEqual({ type: 'navigate', to: UMPIRE_ADD_APPOINTMENT_PATH })
    expect(labels(c)?.slice(1)).toEqual(['ASK: What is missing from my record?', 'LEARN: Who are the umpires based in my country?'])
  })

  it('no role, no context', () => {
    expect(aiContextFor(null, {})).toBeNull()
    expect(aiContextFor({ role: null }, {})).toBeNull()
  })

  it('never a fit verdict, score or ranking in any chip or choice', () => {
    for (const role of ['player', 'coach', 'club', 'brand', 'umpire']) {
      const text = JSON.stringify(aiContextFor({ role }, { openRoles: 2, pendingApplicants: 3, products: 1, appointments: 4, coachingRolesOpen: 5 }))
      expect(text).not.toMatch(/score|rank|match|best|guarantee/i)
    }
  })
})
