import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { daysLeftLabel, daysLeftToReply, fitChipLabel, fitRows, fitTarget, isDaysLeftUrgent, personRoleLine, pipelineOf, waitingNotice } from '@/lib/clubRecruiting'

const invokeMock = vi.fn()
const updateEq = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: () => ({ update: () => ({ eq: (...a: unknown[]) => ({ select: () => updateEq(...a) }) }) }),
  },
}))

import { holdDecision, undoDecision, flushDecisions, UNDO_WINDOW_MS } from '@/lib/pendingDecisions'

const NOW = new Date('2026-09-24T12:00:00Z')

describe('club recruiting copy', () => {
  it('counts days left to reply from applied_at + expiry_days', () => {
    expect(daysLeftToReply('2026-09-17T10:00:00Z', 14, NOW)).toBe(7)
    expect(daysLeftToReply('2026-09-01T10:00:00Z', 14, NOW)).toBe(0)
    expect(daysLeftLabel(1)).toBe('1 day left')
    expect(daysLeftLabel(0)).toBe('Closes today')
  })

  it('turns amber only at 5 days or fewer', () => {
    expect(isDaysLeftUrgent(5)).toBe(true)
    expect(isDaysLeftUrgent(6)).toBe(false)
    expect(isDaysLeftUrgent(null)).toBe(false)
  })

  it('builds the pipeline and ignores withdrawn', () => {
    expect(pipelineOf(['pending', 'pending', 'shortlisted', 'rejected', 'no_response', 'maybe', 'withdrawn'])).toEqual({ toReview: 2, shortlisted: 1, maybe: 1, declined: 1, closed: 1, total: 6 })
  })

  it('writes the waiting notice from the oldest pending application, and hides at 0', () => {
    expect(waitingNotice(['2026-09-15T00:00:00Z', '2026-09-20T00:00:00Z', '2026-09-22T00:00:00Z'], 14, NOW)).toEqual({
      title: '3 applicants waiting for a reply',
      detail: 'The oldest closes in 5 days if you don’t answer.',
    })
    expect(waitingNotice([], 14, NOW)).toBeNull()
  })

  it('labels fit and passes the target with the exact casing compute_club_fit needs', () => {
    expect(fitChipLabel('green')).toBe('Strong fit')
    expect(fitChipLabel('yellow')).toBe('Possible fit')
    expect(fitChipLabel('grey')).toBeNull()
    expect(fitTarget('men')).toBe('Men')
    expect(fitTarget('Women')).toBe('Women')
    expect(fitTarget('mixed')).toBe('Mixed')
    // Never a raw youth value into compute_club_fit (no Boys/Girls branch in the DB).
    expect(fitTarget('Boys')).toBe('Men')
    expect(fitTarget('girls')).toBe('Women')
    expect(fitTarget('Veterans')).toBeNull()
    expect(fitTarget(null)).toBeNull()
  })

  it('names the missing side for Level instead of a number', () => {
    const rows = fitRows({ gender_match: 1, availability: 0.8, recency: 0.7, competition_proximity: 0 }, {
      roleGender: 'Men', playerCategoryLabel: 'Adult men', firstName: 'Leandro', lastActiveDays: 2,
      playerClub: 'Old Lions', playerLeagueKnown: false, clubLeagueKnown: true,
    })
    expect(rows.map((r) => r.ok)).toEqual([true, true, true, false])
    expect(rows[2].detail).toBe('On Hockia 2 days ago')
    expect(rows[3].detail).toBe('Can’t compare yet — plays for Old Lions, which has no league on Hockia.')
    expect(rows.some((r) => /%/.test(r.detail))).toBe(false)
  })

  it('writes the role line under every person', () => {
    expect(personRoleLine({ role: 'player', position: 'midfielder', secondaryPosition: 'defender' })).toBe('Player · Midfielder · Defender')
    expect(personRoleLine({ role: 'player', position: 'midfielder', secondaryPosition: 'midfielder' })).toBe('Player · Midfielder')
  })
})

describe('held decisions (5 s Undo)', () => {
  beforeEach(() => { vi.useFakeTimers(); invokeMock.mockReset(); updateEq.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('writes nothing when undone inside the window', async () => {
    holdDecision({ kind: 'status', applicationId: 'a1', status: 'shortlisted', metadata: {} })
    expect(undoDecision('a1')).toBe(true)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100)
    expect(updateEq).not.toHaveBeenCalled()
  })

  it('writes after the window', async () => {
    updateEq.mockResolvedValue({ data: [{ id: 'a2' }], error: null })
    const done = vi.fn()
    holdDecision({ kind: 'status', applicationId: 'a2', status: 'maybe', metadata: {} }, done)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100)
    expect(updateEq).toHaveBeenCalledWith('id', 'a2')
    expect(done).toHaveBeenCalledWith(true, undefined)
  })

  it('reports a withdrawn application when the update matches no row', async () => {
    updateEq.mockResolvedValue({ data: [], error: null })
    const done = vi.fn()
    holdDecision({ kind: 'status', applicationId: 'a4', status: 'shortlisted', metadata: {} }, done)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100)
    expect(done).toHaveBeenCalledWith(false, true)
  })

  it('sends a decline through the feedback function in one call, and flushes when the page hides', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null })
    holdDecision({ kind: 'decline', applicationId: 'a3', reason: 'different_level', message: 'Thanks for applying.' })
    flushDecisions()
    await vi.runAllTimersAsync()
    expect(invokeMock).toHaveBeenCalledWith('application-feedback', { body: { mode: 'decline', application_id: 'a3', reason: 'different_level', message: 'Thanks for applying.' } })
    expect(undoDecision('a3')).toBe(false)
  })
})
