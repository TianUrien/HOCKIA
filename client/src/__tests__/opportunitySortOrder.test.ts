/**
 * Opportunities list ordering — founder ruling 2026-08-13.
 *
 * "Newest" sorts strictly by created_at, descending. This REVERTS the
 * 2026-08-12 publish-date ordering, which had an unintended consequence:
 * the set_opportunity_published_at trigger re-stamps published_at whenever
 * a closed listing is re-opened, so every RENEWED listing floated to the
 * top of "Newest" above genuinely new ones (a May listing renewed in August
 * outranked an August creation — the founder's screenshot showed creations
 * from 04 Jun and 18 May in the top two slots).
 *
 * created_at is the stable key: it never changes after insert, it is what
 * the admin panel sorts and displays, and it is what the shipped native
 * builds (Android 1.13 / iOS 1.3.12, built before the 08-12 change) already
 * use — so this also restores web/native/admin consistency.
 *
 * Accepted trade-off, ruled on with the data in front of us: a renewed old
 * listing keeps its chronological place mid-list even when the Home feed
 * announces its re-publish. If renewals ever need surfacing, that is a
 * badge/feature, not a sort-order change.
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
const created = (v: Row) => time(v.created_at)

function sortRows(rows: Row[], sort: 'newest' | 'oldest' | 'deadline'): Row[] {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return created(a) - created(b)
    if (sort === 'deadline') {
      const da = a.application_deadline ? time(a.application_deadline) : Infinity
      const db = b.application_deadline ? time(b.application_deadline) : Infinity
      if (da !== db) return da - db
      return created(b) - created(a)
    }
    return created(b) - created(a)
  })
}

// The real production rows behind both reports.
const RENEWED_JUN: Row = { id: 'head-coach', created_at: '2026-06-04T09:21:00Z', published_at: '2026-08-12T21:10:00Z' }
const CREATED_AUG: Row = { id: 'elite-men', created_at: '2026-08-02T15:43:00Z', published_at: '2026-08-02T15:43:00Z' }
const RENEWED_MAY: Row = { id: 'senior-men', created_at: '2026-05-18T14:19:00Z', published_at: '2026-08-04T16:05:00Z' }
const NEVER_PUBLISHED: Row = { id: 'no-publish', created_at: '2026-07-01T00:00:00Z', published_at: null }

describe('opportunity list ordering (created_at, founder ruling 2026-08-13)', () => {
  it('newest = strictly created_at desc — a renewal does NOT jump the queue', () => {
    const sorted = sortRows([RENEWED_MAY, RENEWED_JUN, CREATED_AUG], 'newest')
    // created 02 Aug > 04 Jun > 18 May, regardless of publish/renewal dates
    expect(sorted.map((r) => r.id)).toEqual(['elite-men', 'head-coach', 'senior-men'])
  })

  it('would have FAILED under the 08-12 publish ordering (the reported bug)', () => {
    const byPublished = [RENEWED_MAY, RENEWED_JUN, CREATED_AUG]
      .sort((a, b) => time(b.published_at ?? b.created_at) - time(a.published_at ?? a.created_at))
      .map((r) => r.id)
    // The symptom in the founder's screenshot: both renewals above the
    // genuinely newest creation.
    expect(byPublished).toEqual(['head-coach', 'senior-men', 'elite-men'])
    expect(byPublished[0]).not.toBe('elite-men')
  })

  it('published_at is entirely ignored — a null publish changes nothing', () => {
    const sorted = sortRows([NEVER_PUBLISHED, CREATED_AUG, RENEWED_JUN], 'newest')
    // 02 Aug > 01 Jul > 04 Jun by creation alone
    expect(sorted.map((r) => r.id)).toEqual(['elite-men', 'no-publish', 'head-coach'])
  })

  it('oldest reverses on the same creation-date basis', () => {
    const sorted = sortRows([RENEWED_JUN, CREATED_AUG, RENEWED_MAY], 'oldest')
    expect(sorted.map((r) => r.id)).toEqual(['senior-men', 'head-coach', 'elite-men'])
  })

  it('deadline sort tie-breaks on creation date', () => {
    const a: Row = { ...RENEWED_JUN, application_deadline: '2026-09-01' }
    const b: Row = { ...CREATED_AUG, application_deadline: '2026-09-01' }
    // Same deadline → the more recently CREATED one first, even though the
    // other was renewed more recently.
    expect(sortRows([a, b], 'deadline').map((r) => r.id)).toEqual(['elite-men', 'head-coach'])
  })

  it('sooner deadline still beats creation recency', () => {
    const soon: Row = { ...RENEWED_MAY, application_deadline: '2026-08-20' }
    const later: Row = { ...CREATED_AUG, application_deadline: '2026-09-01' }
    expect(sortRows([later, soon], 'deadline').map((r) => r.id)).toEqual(['senior-men', 'elite-men'])
  })
})
