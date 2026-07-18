/**
 * Next-best-actions rules engine (Market Intelligence Phase 1).
 *
 * Locks the decision layer's contracts: each rule's trigger condition and,
 * just as important, its SILENCE below the minimum sample (small-N honesty —
 * a rule that fires on 2 applications is noise, not advice). Thresholds are
 * intentionally asserted so a future tweak is a conscious test change.
 */

import { describe, it, expect } from 'vitest'
import { evaluateMarketRules } from '@/features/admin/lib/marketRules'
import type { MarketIntelligence, MarketMatrixCell } from '@/features/admin/types'

const cell = (over: Partial<MarketMatrixCell>): MarketMatrixCell => ({
  position: 'goalkeeper',
  gender: 'Men',
  demand_window: 0,
  demand_open_now: 0,
  supply_active: 0,
  supply_stale: 0,
  apps_window: 0,
  ...over,
})

const base = (over: Partial<MarketIntelligence> = {}): MarketIntelligence => ({
  meta: { computed_at: '2026-07-18T00:00:00', demand_window_days: 90, test_accounts_excluded: true },
  health: {
    open_vacancies: 0, active_supply: 10, stale_supply: 0,
    median_apps_per_vacancy: 2, cold_vacancies: 0, open_over_14d: 0,
    total_apps: 0, responded_apps: 0, pending_apps: 0,
    filled_via_hockia: 0, closed_vacancies: 0,
    median_hours_to_first_app: null, median_days_to_fill: null,
  },
  matrix: [],
  coach_demand: { open_now: 0, demand_window: 0 },
  vacancy_funnel: { published: 0, viewed: 0, applied: 0, responded: 0, filled: 0 },
  player_funnel: { players: 0, completed_profile: 0, open_to_play: 0, viewed_vacancy: 0, applied: 0, got_response: 0, advanced: 0 },
  clubs: [],
  demand_by_country: [],
  supply_by_country: [],
  ...over,
})

describe('marketRules — gap rule (R1)', () => {
  it('fires on real demand + thin supply + weak applications, naming the segment', () => {
    const mi = base({
      matrix: [cell({ position: 'goalkeeper', gender: 'Men', demand_window: 3, supply_active: 2, apps_window: 1 })],
    })
    const recs = evaluateMarketRules(mi)
    const gap = recs.find((r) => r.id === 'gap:Men:goalkeeper')
    expect(gap).toBeTruthy()
    expect(gap!.priority).toBe(1)
    expect(gap!.owner).toBe('Acquisition')
    expect(gap!.title).toMatch(/Men's Goalkeepers/)
  })

  it('stays silent when demand is below 2 (too small to mean anything)', () => {
    const mi = base({
      matrix: [cell({ demand_window: 1, supply_active: 0, apps_window: 0 })],
    })
    expect(evaluateMarketRules(mi).find((r) => r.id.startsWith('gap:'))).toBeUndefined()
  })

  it('stays silent when applications already cover demand', () => {
    const mi = base({
      matrix: [cell({ demand_window: 3, supply_active: 1, apps_window: 5 })],
    })
    expect(evaluateMarketRules(mi).find((r) => r.id.startsWith('gap:'))).toBeUndefined()
  })
})

describe('marketRules — club backlog rule (R2)', () => {
  const club = (over: Partial<MarketIntelligence['clubs'][0]>) => ({
    club_profile_id: 'c1', club_name: 'Test HC', posted: 2, open_now: 1,
    apps_received: 5, responded: 0, pending_backlog: 0, oldest_pending_days: null,
    filled: 0, median_response_days: null, ...over,
  })

  it('fires when 3+ applications wait 7+ days, naming the club', () => {
    const mi = base({ clubs: [club({ pending_backlog: 4, oldest_pending_days: 12 })] })
    const rec = evaluateMarketRules(mi).find((r) => r.id === 'backlog:c1')
    expect(rec).toBeTruthy()
    expect(rec!.title).toMatch(/Test HC/)
    expect(rec!.owner).toBe('Ops')
  })

  it('stays silent for a fresh backlog (under 7 days)', () => {
    const mi = base({ clubs: [club({ pending_backlog: 4, oldest_pending_days: 2 })] })
    expect(evaluateMarketRules(mi).find((r) => r.id === 'backlog:c1')).toBeUndefined()
  })
})

describe('marketRules — response-rate rule (R6)', () => {
  it('fires below 50% response with enough sample', () => {
    const mi = base({ health: { ...base().health, total_apps: 20, responded_apps: 4 } })
    const rec = evaluateMarketRules(mi).find((r) => r.id === 'response-rate')
    expect(rec).toBeTruthy()
    expect(rec!.title).toMatch(/20%/)
  })

  it('stays silent under 5 applications total', () => {
    const mi = base({ health: { ...base().health, total_apps: 4, responded_apps: 0 } })
    expect(evaluateMarketRules(mi).find((r) => r.id === 'response-rate')).toBeUndefined()
  })
})

describe('marketRules — output contract', () => {
  it('caps at 5 recommendations, priority 1 first', () => {
    const mi = base({
      matrix: [
        cell({ position: 'goalkeeper', gender: 'Men', demand_window: 4, supply_active: 1, apps_window: 0 }),
        cell({ position: 'defender', gender: 'Women', demand_window: 3, supply_active: 0, apps_window: 0 }),
      ],
      clubs: [
        { club_profile_id: 'a', club_name: 'A', posted: 1, open_now: 1, apps_received: 5, responded: 0, pending_backlog: 5, oldest_pending_days: 10, filled: 0, median_response_days: null },
        { club_profile_id: 'b', club_name: 'B', posted: 1, open_now: 1, apps_received: 4, responded: 0, pending_backlog: 4, oldest_pending_days: 9, filled: 0, median_response_days: null },
      ],
      health: { ...base().health, total_apps: 20, responded_apps: 2, cold_vacancies: 3, stale_supply: 10, active_supply: 5 },
      vacancy_funnel: { published: 10, viewed: 8, applied: 2, responded: 1, filled: 0 },
    })
    const recs = evaluateMarketRules(mi)
    expect(recs.length).toBe(5)
    expect(recs[0].priority).toBe(1)
    // Sorted non-decreasing by priority.
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].priority).toBeGreaterThanOrEqual(recs[i - 1].priority)
    }
  })

  it('returns an empty list on a quiet marketplace (no fires ≠ no data)', () => {
    expect(evaluateMarketRules(base())).toEqual([])
  })
})