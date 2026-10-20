import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { photosForPair } from '@/hooks/useActivityPhotos'
import { isStaleChunkMessage, STALE_EXPORT_MESSAGE } from '@/lib/sentryFilters'

/** Sentry fixes 2026-10-20: batched Home photo sets (D7) and the stale-export chunk signal (DP/DM). */
describe('photosForPair', () => {
  const rows = [
    { user_id: 'a', photo_url: 'a-2', created_at: '2026-10-19T10:00:00Z' },
    { user_id: 'a', photo_url: 'a-1', created_at: '2026-10-19T08:00:00Z' },
    { user_id: 'a', photo_url: 'a-prev-day', created_at: '2026-10-18T23:59:59Z' },
    { user_id: 'b', photo_url: 'b-1', created_at: '2026-10-19T09:00:00Z' },
    { user_id: 'a', photo_url: null, created_at: '2026-10-19T11:00:00Z' },
  ]
  it('splits one batched result per (uploader, UTC day), oldest first, dropping empty urls', () => {
    expect(photosForPair(rows, { uploaderId: 'a', day: '2026-10-19' })).toEqual(['a-1', 'a-2'])
    expect(photosForPair(rows, { uploaderId: 'a', day: '2026-10-18' })).toEqual(['a-prev-day'])
    expect(photosForPair(rows, { uploaderId: 'b', day: '2026-10-19' })).toEqual(['b-1'])
    expect(photosForPair(rows, { uploaderId: 'c', day: '2026-10-19' })).toEqual([])
  })
})

describe('stale export signal', () => {
  it('is recognised as a stale chunk so lazyWithRetry recovers instead of crashing', () => {
    expect(isStaleChunkMessage(STALE_EXPORT_MESSAGE)).toBe(true)
    expect(isStaleChunkMessage("Cannot read properties of undefined (reading 'AdminGuard')")).toBe(false)
  })
})
