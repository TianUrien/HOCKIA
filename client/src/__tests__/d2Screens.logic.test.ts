/**
 * D2 · 30-second profile — pure logic behind the screens: "not deployed yet"
 * detection, the Open to play checklist + consent copy, 18+ by DOB, the
 * club's "Applied to …" line, key-fact Add labels, the completeness reply and
 * which role the club-only fit card compares against.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))

import { isMissingBackendError } from '@/lib/missingBackend'
import { openToPlayChecklist, openToPlayConsent } from '@/lib/openToPlayScreen'
import { isAdultByDob } from '@/lib/openToPlay'
import { appliedLine, keyFactActionLabel, leagueSideFor } from '@/lib/profileD2'
import { parseCompleteness } from '@/hooks/useProfileCompleteness'
import { pickFitRole } from '@/hooks/useClubViewOfPlayer'
import type { KeyFact } from '@/lib/keyFacts'

describe('isMissingBackendError', () => {
  it('reads PostgREST / Postgres "not found" codes as not deployed', () => {
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) expect(isMissingBackendError({ code })).toBe(true)
    expect(isMissingBackendError({ status: 404 })).toBe(true)
    expect(isMissingBackendError({ message: 'Could not find the function public.player_league(p_uid) in the schema cache' })).toBe(true)
  })
  it('does not swallow real failures', () => {
    expect(isMissingBackendError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingBackendError({ code: '42703', message: 'column x of relation y does not exist' })).toBe(false)
    expect(isMissingBackendError(null)).toBe(false)
  })
})

describe('openToPlayChecklist', () => {
  it('ticks what is there and says "Not set" for the rest', () => {
    const rows = openToPlayChecklist({ passports: [{ name: 'Argentina', flag: '🇦🇷', isEu: false }], fullMatches: 1, highlights: 4, league: null })
    expect(rows.map((r) => [r.key, r.done, r.detail])).toEqual([
      ['passport', true, '🇦🇷 Argentina'],
      ['video', true, '1 full match · 4 highlights'],
      ['league', false, 'Not set'],
    ])
  })
  it('labels a self-reported league', () => {
    const [, , league] = openToPlayChecklist({ passports: [], fullMatches: 0, highlights: 0, league: { name: 'Torneo NOA', source: 'self_reported' } })
    expect(league).toMatchObject({ done: true, detail: 'Torneo NOA · self-reported' })
  })
})

describe('openToPlayConsent', () => {
  it('names the position and what switching off does', () => {
    expect(openToPlayConsent(true, 'midfielder')).toBe('While you’re open to play, Hockia can suggest your profile to clubs looking for a midfielder. Turn this off and you stop being suggested.')
    expect(openToPlayConsent(false, null)).toContain('looking for a player')
  })
})

describe('isAdultByDob', () => {
  const today = new Date(Date.UTC(2026, 8, 26))
  it('18 on the birthday, not the day before; unknown is not adult', () => {
    expect(isAdultByDob('2008-09-26', today)).toBe(true)
    expect(isAdultByDob('2008-09-27', today)).toBe(false)
    expect(isAdultByDob('2009-11-02', today)).toBe(false)
    expect(isAdultByDob(null, today)).toBe(false)
  })
})

describe('appliedLine', () => {
  const now = new Date(2026, 8, 26, 12)
  it('pending → date + days left to reply', () => {
    expect(appliedLine({ status: 'pending', appliedAt: new Date(2026, 8, 20, 9).toISOString(), expiryDays: 14 }, now)).toBe('Sep 20 · 8 days left to reply')
  })
  it('answered → date + the decision', () => {
    expect(appliedLine({ status: 'shortlisted', appliedAt: new Date(2026, 8, 17).toISOString(), expiryDays: 14 }, now)).toBe('Sep 17 · Shortlisted')
  })
})

describe('keyFactActionLabel', () => {
  const f = (p: Partial<KeyFact>): KeyFact => ({ id: 'passport', label: 'Passport', value: '', missing: false, detail: null, detailMissing: false, badge: null, extraLines: [], action: null, ...p })
  it('matches the Figma owner links', () => {
    expect(keyFactActionLabel(f({ action: 'add_league' }))).toBe('Add league')
    expect(keyFactActionLabel(f({ action: 'add_date' }))).toBe('Add date')
    expect(keyFactActionLabel(f({ action: 'add_passport', missing: false }))).toBe('Add another')
    expect(keyFactActionLabel(f({ action: 'add_passport', missing: true }))).toBe('Add passport')
    expect(keyFactActionLabel(f({}))).toBeNull()
  })
})

describe('leagueSideFor', () => {
  it('women / girls → womens_league_id, everyone else → mens_league_id', () => {
    expect(leagueSideFor('adult_women')).toBe('womens_league_id')
    expect(leagueSideFor('girls')).toBe('womens_league_id')
    expect(leagueSideFor('adult_men')).toBe('mens_league_id')
    expect(leagueSideFor(null)).toBe('mens_league_id')
  })
})

describe('parseCompleteness', () => {
  it('reads pct + parts, clamps, rejects junk', () => {
    expect(parseCompleteness({ pct: 72, parts: [{ key: 'video', weight: 20, done: false }] })).toEqual({ pct: 72, parts: [{ key: 'video', weight: 20, done: false, bonus: undefined }] })
    expect(parseCompleteness({ pct: 140, parts: null })).toEqual({ pct: 100, parts: null })
    expect(parseCompleteness(null)).toBeNull()
    expect(parseCompleteness({ pct: 'x' })).toBeNull()
  })
})

describe('pickFitRole', () => {
  const a = { id: 'a', title: 'A', gender: 'Men' }
  const b = { id: 'b', title: 'B', gender: 'Women' }
  it('applied role first, then the active context role, then the only open role', () => {
    const application = { id: 'x', status: 'pending', appliedAt: null, metadata: {}, role: b, expiryDays: 14 }
    expect(pickFitRole({ application, roles: [a, b], activeOpportunityId: 'a' })).toBe(b)
    expect(pickFitRole({ application: null, roles: [a, b], activeOpportunityId: 'a' })).toBe(a)
    expect(pickFitRole({ application: null, roles: [a], activeOpportunityId: null })).toBe(a)
    expect(pickFitRole({ application: null, roles: [a, b], activeOpportunityId: null })).toBeNull()
  })
})
