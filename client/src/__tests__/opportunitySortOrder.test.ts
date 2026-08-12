/**
 * Opportunities list ordering — regression for the 2026-08-08 report
 * "Home says a new opportunity was posted, but it isn't on Opportunities".
 *
 * It WAS on the page — sixth of eleven. The listing sorted by `created_at`
 * while the Home feed announces the PUBLISH event, so a Head Coach listing
 * created 04 Jun and published 12 Aug sat between July and May entries. The
 * founder looked at the top of a list that had just advertised it as new and
 * concluded it was missing. A second live listing (created 18 May, published
 * 04 Aug) had the same shape.
 *
 * The rule: "posted" means published_at, falling back to created_at when a
 * row has no publish timestamp.
 */

import { describe, it, expect } from 'vitest'

type Row = {
  id: string
  created_at: string
  published_at?: string | null
  application_deadline?: string | null
}

/** Mirrors the comparator in OpportunitiesPage's sort memo. */
const time = (d: string | null | undefined) => (d ? new Date(d).getTime() : 0)
const posted = (v: Row) => time(v.published_at ?? v.created_at)

function sortRows(rows: Row[], sort: 'newest' | 'oldest' | 'deadline'): Row[] {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return posted(a) - posted(b)
    if (sort === 'deadline') {
      const da = a.application_deadline ? time(a.application_deadline) : Infinity
      const db = b.application_deadline ? time(b.application_deadline) : Infinity
      if (da !== db) return da - db
      return posted(b) - posted(a)
    }
    return posted(b) - posted(a)
  })
}

// The real production rows that produced the report.
const HEAD_COACH: Row = { id: 'head-coach', created_at: '2026-06-04T09:21:00Z', published_at: '2026-08-12T21:10:00Z' }
const RECENT_CREATED: Row = { id: 'elite-men', created_at: '2026-08-02T15:43:00Z', published_at: '2026-08-02T15:43:00Z' }
const OLD_REPUBLISHED: Row = { id: 'senior-men', created_at: '2026-05-18T14:19:00Z', published_at: '2026-08-04T16:05:00Z' }
const NEVER_PUBLISHED: Row = { id: 'no-publish', created_at: '2026-07-01T00:00:00Z', published_at: null }

describe('opportunity list ordering', () => {
  it('a recently PUBLISHED but long-ago CREATED listing sorts first', () => {
    const sorted = sortRows([RECENT_CREATED, HEAD_COACH, OLD_REPUBLISHED], 'newest')
    // published 12 Aug > 04 Aug > 02 Aug, regardless of creation dates
    expect(sorted.map((r) => r.id)).toEqual(['head-coach', 'senior-men', 'elite-men'])
  })

  it('would have FAILED under the old created_at ordering (the bug)', () => {
    const byCreated = [RECENT_CREATED, HEAD_COACH, OLD_REPUBLISHED]
      .sort((a, b) => time(b.created_at) - time(a.created_at))
      .map((r) => r.id)
    // Demonstrates the reported symptom: the newly published listing is buried.
    expect(byCreated).toEqual(['elite-men', 'head-coach', 'senior-men'])
    expect(byCreated[0]).not.toBe('head-coach')
  })

  it('falls back to created_at when a row has no published_at', () => {
    const sorted = sortRows([NEVER_PUBLISHED, RECENT_CREATED], 'newest')
    // 02 Aug published beats 01 Jul created
    expect(sorted.map((r) => r.id)).toEqual(['elite-men', 'no-publish'])
  })

  it('oldest reverses on the same publish-date basis', () => {
    const sorted = sortRows([HEAD_COACH, RECENT_CREATED, OLD_REPUBLISHED], 'oldest')
    expect(sorted.map((r) => r.id)).toEqual(['elite-men', 'senior-men', 'head-coach'])
  })

  it('deadline sort tie-breaks on publish date, not creation date', () => {
    const a: Row = { ...HEAD_COACH, application_deadline: '2026-09-01' }
    const b: Row = { ...RECENT_CREATED, application_deadline: '2026-09-01' }
    expect(sortRows([b, a], 'deadline').map((r) => r.id)).toEqual(['head-coach', 'elite-men'])
  })
})
