import { render, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import NativeVideosSection from '@/components/media/NativeVideosSection'

/**
 * The recruitment evidence section (profile Media tab) lists ONLY
 * kind IN ('highlight','full_match').
 *
 * player_videos RLS never reads `kind`, so this `.in()` filter is the only
 * thing keeping a Home video post (kind='post') or a Gallery video
 * (kind='reel') out of the recruitment gallery. This test fails loudly if the
 * filter is dropped or widened — the mirror of galleryVideoSeparation.test.tsx.
 */

interface QueryRecord {
  table: string
  eqs: Array<[string, unknown]>
  ins: Array<[string, unknown[]]>
}

const queries: QueryRecord[] = []

function makeBuilder(table: string) {
  const record: QueryRecord = { table, eqs: [], ins: [] }
  queries.push(record)
  const builder = {
    select: () => builder,
    eq: (col: string, v: unknown) => { record.eqs.push([col, v]); return builder },
    in: (col: string, v: unknown[]) => { record.ins.push([col, v]); return builder },
    order: () => builder,
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    functions: { invoke: vi.fn() },
  },
}))

const toastMocks = vi.hoisted(() => ({ addToast: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToastStore: () => toastMocks }))

vi.mock('@/components/media/NativeVideoPlayer', () => ({
  default: () => <div data-testid="player" />,
}))
vi.mock('@/components/media/UploadVideoModal', () => ({
  default: () => null,
}))
vi.mock('@/components/ConfirmActionModal', () => ({
  default: () => null,
}))

beforeEach(() => {
  queries.length = 0
})

describe('recruitment section ↔ video-kind separation', () => {
  it('queries player_videos pinned to highlight/full_match only', async () => {
    render(<NativeVideosSection playerUserId="player-1" readOnly />)

    await waitFor(() => {
      expect(queries.some((q) => q.table === 'player_videos')).toBe(true)
    })

    const q = queries.find((q) => q.table === 'player_videos')!
    expect(q.eqs).toContainEqual(['user_id', 'player-1'])

    // The fence: exactly one kind filter, recruitment kinds only.
    expect(q.ins).toHaveLength(1)
    const [col, kinds] = q.ins[0]
    expect(col).toBe('kind')
    expect([...kinds].sort()).toEqual(['full_match', 'highlight'])
    expect(kinds).not.toContain('post')
    expect(kinds).not.toContain('reel')
  })
})
