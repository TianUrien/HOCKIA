import { describe, expect, it } from 'vitest'
import { buildRetentionCsv, retentionCsvFilename } from '@/features/admin/lib/retentionCsv'
import { retentionFilterParams } from '@/features/admin/api/retentionApi'
import type { RetentionCohortTable } from '@/features/admin/types/retention'

/**
 * The export must be the screen, in a file: same rows, same numerators and
 * denominators, same "not eligible yet" blanks — plus the definition in the
 * header, because a lone percentage in a spreadsheet is how retention numbers
 * get misquoted three meetings later.
 */
const table: RetentionCohortTable = {
  method: 'bracket',
  activity: 'meaningful',
  grain: 'week',
  timezone: 'UTC',
  cohort_from: '2026-03-01',
  cohort_to: '2026-08-27',
  days: [7, 15, 30],
  generated_at: '2026-08-27T09:00:00Z',
  rows: [
    {
      cohort_start: '2026-08-17',
      cohort_size: 9,
      cells: [
        { day: 7, eligible: 9, retained: 3, pct: 33.3 },
        { day: 15, eligible: 0, retained: 0, pct: null },
        { day: 30, eligible: 0, retained: 0, pct: null },
      ],
    },
    {
      cohort_start: '2026-08-10',
      cohort_size: 12,
      cells: [
        { day: 7, eligible: 12, retained: 0, pct: 0 },
        { day: 15, eligible: 12, retained: 2, pct: 16.7 },
        { day: 30, eligible: 0, retained: 0, pct: null },
      ],
    },
  ],
}

const parse = (csv: string) => {
  const lines = csv.split('\n')
  const meta = lines.filter((l) => l.startsWith('#'))
  const rows = lines.filter((l) => !l.startsWith('#'))
  return { meta, header: rows[0].split(','), body: rows.slice(1).map((r) => r.split(',')) }
}

describe('retention CSV export', () => {
  it('carries every cell exactly as rendered: retained, eligible and percentage', () => {
    const { header, body } = parse(buildRetentionCsv(table))
    expect(header).toEqual([
      'cohort_start', 'cohort_size',
      'd7_retained', 'd7_eligible', 'd7_pct',
      'd15_retained', 'd15_eligible', 'd15_pct',
      'd30_retained', 'd30_eligible', 'd30_pct',
    ])
    expect(body[0]).toEqual(['2026-08-17', '9', '3', '9', '33.3', '0', '0', '', '0', '0', ''])
    expect(body[1]).toEqual(['2026-08-10', '12', '0', '12', '0', '2', '12', '16.7', '0', '0', ''])
  })

  it('distinguishes a true 0% from "not eligible yet" (blank)', () => {
    const { body } = parse(buildRetentionCsv(table))
    expect(body[1][4]).toBe('0')  // D7: 0 of 12 — a real zero
    expect(body[0][7]).toBe('')   // D15: nobody eligible — blank, not zero
  })

  it('records the definition and the active filters in the header block', () => {
    const csv = buildRetentionCsv(table, { role: 'player', countryId: 11, platform: 'ios', source: 'google' })
    const { meta } = parse(csv)
    const joined = meta.join('\n')
    expect(joined).toContain('# method,Returned that week (days N–N+6)')
    expect(joined).toContain('# activity,Meaningful activity')
    expect(joined).toContain('# timezone,UTC')
    expect(joined).toContain('# cohort_range,2026-03-01 to 2026-08-27')
    expect(joined).toContain('role=player')
    expect(joined).toContain('country_id=11')
    expect(joined).toContain('platform=ios')
    expect(joined).toContain('source=google')
    expect(joined).toContain('blank percentage = no member eligible yet')
  })

  it('says "none" when no filter is applied, so an export is never ambiguous', () => {
    expect(buildRetentionCsv(table)).toContain('# filters,none')
  })

  it('names the file after the exact window it covers', () => {
    expect(retentionCsvFilename(table)).toBe('hockia-retention-week-2026-03-01-to-2026-08-27.csv')
  })

  it('the summary cards and the grid send the identical filter payload', () => {
    // One mapper, used by both calls — a filter can never apply to one and
    // not the other.
    expect(retentionFilterParams({ role: 'coach', countryId: 4, platform: 'android', source: 'meta' })).toEqual({
      p_role: 'coach', p_country_id: 4, p_platform: 'android', p_source: 'meta',
    })
    expect(retentionFilterParams({})).toEqual({
      p_role: null, p_country_id: null, p_platform: null, p_source: null,
    })
  })
})
