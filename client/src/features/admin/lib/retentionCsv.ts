/**
 * CSV export for the cohort grid.
 *
 * Built from the SAME payload the grid renders, so an export can never show a
 * different number than the screen it came from. The header block records the
 * definition (method, activity, timezone, filters) because a bare percentage
 * in a spreadsheet is exactly how retention numbers get misquoted.
 */

import type { RetentionCohortTable, RetentionFilters } from '../types/retention'
import { RETENTION_ACTIVITY_LABEL, RETENTION_METHOD_LABEL } from '../types/retention'

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildRetentionCsv(
  table: RetentionCohortTable,
  filters: RetentionFilters = {},
): string {
  const days = table.days ?? []
  const activeFilters = [
    filters.role ? `role=${filters.role}` : null,
    filters.countryId ? `country_id=${filters.countryId}` : null,
    filters.platform ? `platform=${filters.platform}` : null,
    filters.source ? `source=${filters.source}` : null,
  ].filter(Boolean)

  const meta = [
    `# HOCKIA retention export`,
    `# generated_at,${table.generated_at}`,
    `# method,${RETENTION_METHOD_LABEL[table.method]}`,
    `# activity,${RETENTION_ACTIVITY_LABEL[table.activity]}`,
    `# timezone,${table.timezone}`,
    `# grain,${table.grain}`,
    `# cohort_range,${table.cohort_from} to ${table.cohort_to}`,
    `# filters,${activeFilters.length ? activeFilters.join(' ') : 'none'}`,
    `# note,blank percentage = no member eligible yet (not zero)`,
  ]

  const header = [
    'cohort_start',
    'cohort_size',
    ...days.flatMap((d) => [`d${d}_retained`, `d${d}_eligible`, `d${d}_pct`]),
  ]

  const rows = table.rows.map((row) => {
    const byDay = new Map(row.cells.map((c) => [c.day, c]))
    return [
      row.cohort_start,
      row.cohort_size,
      ...days.flatMap((d) => {
        const cell = byDay.get(d)
        return [cell?.retained ?? 0, cell?.eligible ?? 0, cell?.pct ?? null]
      }),
    ]
  })

  return [
    ...meta,
    header.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\n')
}

export function retentionCsvFilename(table: RetentionCohortTable): string {
  return `hockia-retention-${table.grain}-${table.cohort_from}-to-${table.cohort_to}.csv`
}
