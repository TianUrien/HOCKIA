/**
 * Retention definition tests (D7 / D15 / D30).
 *
 * The percentages are computed in Postgres, so the arithmetic is tested where
 * it lives. `retention_is_eligible` and `retention_day_matches` are the pure,
 * shared predicates every retention report is built from — feeding them
 * synthetic dates pins the exact boundaries (mature vs immature cohorts,
 * exact-day vs rolling windows, UTC edges) without depending on whatever
 * happens to be in the staging database that day.
 *
 * The aggregate RPCs are admin-only, so the non-admin fixtures here assert the
 * authorization fence rather than the numbers.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { authenticatePlayer, hasRequiredEnv, type AuthenticatedClient } from './setup'

const skip = !hasRequiredEnv()

describe.skipIf(skip)('Retention definition (SQL)', () => {
  let user: AuthenticatedClient

  beforeAll(async () => {
    user = await authenticatePlayer()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, params: Record<string, unknown>) => (user.client.rpc as any)(fn, params)

  const eligible = async (cohort: string, day: number, method: string, today: string) => {
    const { data, error } = await rpc('retention_is_eligible', {
      p_cohort_date: cohort, p_day: day, p_method: method, p_today: today,
    })
    expect(error).toBeNull()
    return data as boolean
  }

  const matches = async (activity: string, cohort: string, day: number, method: string) => {
    const { data, error } = await rpc('retention_day_matches', {
      p_activity_date: activity, p_cohort_date: cohort, p_day: day, p_method: method,
    })
    expect(error).toBeNull()
    return data as boolean
  }

  // =========================================================================
  // ELIGIBILITY — a member is measured only once the window has fully elapsed
  // =========================================================================
  describe('eligibility (immature cohorts are excluded, never counted as 0)', () => {
    // Cohort signed up 2026-08-01. Bracket D7 = days 7–13 = Aug 8–14.
    it('D7 bracket: not eligible while the window is still open', async () => {
      expect(await eligible('2026-08-01', 7, 'bracket', '2026-08-10')).toBe(false)
      expect(await eligible('2026-08-01', 7, 'bracket', '2026-08-14')).toBe(false) // last day still running
    })

    it('D7 bracket: eligible the day after the window closes', async () => {
      expect(await eligible('2026-08-01', 7, 'bracket', '2026-08-15')).toBe(true)
      expect(await eligible('2026-08-01', 7, 'bracket', '2026-09-01')).toBe(true)
    })

    it('D15 and D30 mature strictly later than D7', async () => {
      // D15 bracket = days 15–21 → eligible from Aug 23; D30 = days 30–36 → Sep 7.
      expect(await eligible('2026-08-01', 15, 'bracket', '2026-08-22')).toBe(false)
      expect(await eligible('2026-08-01', 15, 'bracket', '2026-08-23')).toBe(true)
      expect(await eligible('2026-08-01', 30, 'bracket', '2026-09-06')).toBe(false)
      expect(await eligible('2026-08-01', 30, 'bracket', '2026-09-07')).toBe(true)
    })

    it('a cohort that signed up today is eligible for nothing', async () => {
      for (const day of [7, 15, 30]) {
        expect(await eligible('2026-08-27', day, 'bracket', '2026-08-27')).toBe(false)
      }
    })

    it('"Return On" needs only day N itself to be in the past', async () => {
      expect(await eligible('2026-08-01', 7, 'on', '2026-08-08')).toBe(false)
      expect(await eligible('2026-08-01', 7, 'on', '2026-08-09')).toBe(true)
    })

    it('"Return On or After" is eligible as soon as day N arrives', async () => {
      // Day 7 after a 2026-08-01 signup is 2026-08-08.
      expect(await eligible('2026-08-01', 7, 'on_or_after', '2026-08-08')).toBe(true)
      expect(await eligible('2026-08-01', 7, 'on_or_after', '2026-08-07')).toBe(false)
    })
  })

  // =========================================================================
  // RETENTION WINDOWS — exact-day vs rolling
  // =========================================================================
  describe('what counts as a Day-N return', () => {
    it('bracket counts any day in N…N+6 and nothing outside it', async () => {
      expect(await matches('2026-08-07', '2026-08-01', 7, 'bracket')).toBe(false) // day 6
      expect(await matches('2026-08-08', '2026-08-01', 7, 'bracket')).toBe(true)  // day 7
      expect(await matches('2026-08-11', '2026-08-01', 7, 'bracket')).toBe(true)  // day 10
      expect(await matches('2026-08-14', '2026-08-01', 7, 'bracket')).toBe(true)  // day 13
      expect(await matches('2026-08-15', '2026-08-01', 7, 'bracket')).toBe(false) // day 14
    })

    it('"Return On" counts the exact day only', async () => {
      expect(await matches('2026-08-08', '2026-08-01', 7, 'on')).toBe(true)
      expect(await matches('2026-08-09', '2026-08-01', 7, 'on')).toBe(false)
      expect(await matches('2026-08-07', '2026-08-01', 7, 'on')).toBe(false)
    })

    it('"Return On or After" counts day N and everything later', async () => {
      expect(await matches('2026-08-07', '2026-08-01', 7, 'on_or_after')).toBe(false)
      expect(await matches('2026-08-08', '2026-08-01', 7, 'on_or_after')).toBe(true)
      expect(await matches('2026-12-25', '2026-08-01', 7, 'on_or_after')).toBe(true)
    })

    it('activity before the checkpoint never counts (signup day included)', async () => {
      for (const method of ['bracket', 'on', 'on_or_after']) {
        expect(await matches('2026-08-01', '2026-08-01', 7, method)).toBe(false)
        expect(await matches('2026-08-03', '2026-08-01', 7, method)).toBe(false)
      }
    })

    it('D15 and D30 windows do not overlap D7', async () => {
      // Day 14 belongs to no bracket; day 15 opens D15.
      expect(await matches('2026-08-15', '2026-08-01', 15, 'bracket')).toBe(false) // day 14
      expect(await matches('2026-08-16', '2026-08-01', 15, 'bracket')).toBe(true)  // day 15
      expect(await matches('2026-08-22', '2026-08-01', 15, 'bracket')).toBe(true)  // day 21
      expect(await matches('2026-08-23', '2026-08-01', 15, 'bracket')).toBe(false) // day 22
      expect(await matches('2026-08-31', '2026-08-01', 30, 'bracket')).toBe(true)  // day 30
      expect(await matches('2026-09-07', '2026-08-01', 30, 'bracket')).toBe(false) // day 37
    })
  })

  // =========================================================================
  // BOUNDARIES — month/year/leap edges must be plain date arithmetic
  // =========================================================================
  describe('date boundaries', () => {
    it('crosses month and year ends correctly', async () => {
      // 2026-12-28 + 7 = 2027-01-04
      expect(await matches('2027-01-04', '2026-12-28', 7, 'on')).toBe(true)
      expect(await eligible('2026-12-28', 7, 'bracket', '2027-01-11')).toBe(true)
      expect(await eligible('2026-12-28', 7, 'bracket', '2027-01-10')).toBe(false)
    })

    it('handles a leap day inside the window', async () => {
      // 2028 is a leap year: 2028-02-25 + 7 = 2028-03-03 (Feb has 29 days).
      expect(await matches('2028-03-03', '2028-02-25', 7, 'on')).toBe(true)
      expect(await matches('2028-03-04', '2028-02-25', 7, 'on')).toBe(false)
    })
  })

  // =========================================================================
  // AUTHORIZATION — the reports are admin-only
  // =========================================================================
  describe('authorization', () => {
    it('a normal member cannot read the retention summary', async () => {
      const { error } = await rpc('admin_get_retention_summary', {})
      expect(error).not.toBeNull()
      expect(error?.message ?? '').toMatch(/admin/i)
    })

    it('a normal member cannot read the cohort table', async () => {
      const { error } = await rpc('admin_get_retention_cohort_table', {})
      expect(error).not.toBeNull()
      expect(error?.message ?? '').toMatch(/admin/i)
    })

    it('the internal facts function is not exposed to the Data API', async () => {
      const { error } = await rpc('admin_retention_facts', {})
      expect(error).not.toBeNull()
    })
  })
})
