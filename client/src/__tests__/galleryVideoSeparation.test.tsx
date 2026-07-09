import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import GalleryManager from '@/components/GalleryManager'

/**
 * The Gallery shows PHOTOS + Gallery VIDEOS (player_videos kind='reel') and
 * nothing else.
 *
 * This is a fence, not a preference. `player_videos` RLS gates on status +
 * visibility + ownership and NEVER on `kind`, so the only thing keeping a Home
 * video post (kind='post') and recruitment evidence (kind='highlight' /
 * 'full_match') out of the Gallery is the `.eq('kind', 'reel')` in the query.
 * If someone drops it, every one of a user's videos appears in their Gallery.
 * These tests fail loudly if that happens.
 */

interface QueryRecord {
  table: string
  eqs: Array<[string, unknown]>
}

const queries: QueryRecord[] = []
let photoRows: unknown[] = []
let videoRows: unknown[] = []

function makeBuilder(table: string) {
  const record: QueryRecord = { table, eqs: [] }
  queries.push(record)

  const rows = () => (table === 'player_videos' ? videoRows : photoRows)

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      record.eqs.push([column, value])
      return builder
    },
    order: () => builder,
    // Thenable so `await` / Promise.all resolve it like a real PostgrestBuilder.
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows(), error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    functions: { invoke: vi.fn() },
    storage: { from: () => ({ upload: vi.fn(), list: vi.fn(), getPublicUrl: vi.fn() }) },
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}))

// addToast must be a STABLE reference — the real zustand store returns one, and
// fetchMedia lists it as a dependency. A fresh fn per render re-runs the fetch
// effect forever.
const toastMocks = vi.hoisted(() => ({ addToast: vi.fn() }))
vi.mock('@/lib/toast', () => ({
  useToastStore: () => toastMocks,
}))

// Avoid pulling tus-js-client into jsdom; the hook is exercised elsewhere.
vi.mock('@/hooks/useNativeVideoUpload', () => ({
  useNativeVideoUpload: () => ({
    phase: 'idle',
    progress: 0,
    error: null,
    upload: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}))

const READY_REEL = {
  id: 'video-1',
  user_id: 'user-1',
  title: 'Training reel',
  description: null,
  status: 'ready',
  duration_seconds: 36.8,
  display_order: 0,
  created_at: '2026-07-09T10:00:00.000Z',
  updated_at: '2026-07-09T10:00:00.000Z',
}

beforeEach(() => {
  queries.length = 0
  photoRows = []
  videoRows = []
})

describe('Gallery ↔ video-kind separation', () => {
  it('queries player_videos pinned to the owner AND kind=reel', async () => {
    videoRows = [READY_REEL]
    render(<GalleryManager mode="profile" entityId="user-1" readOnly />)

    await waitFor(() => {
      expect(queries.some((q) => q.table === 'player_videos')).toBe(true)
    })

    const videoQuery = queries.find((q) => q.table === 'player_videos')!
    // The fence. Removing either eq() re-opens the bleed.
    expect(videoQuery.eqs).toContainEqual(['kind', 'reel'])
    expect(videoQuery.eqs).toContainEqual(['user_id', 'user-1'])

    // And nothing widens it to a recruitment or Home-post kind.
    const kindFilters = videoQuery.eqs.filter(([column]) => column === 'kind')
    expect(kindFilters).toHaveLength(1)
    expect(kindFilters[0][1]).not.toBe('post')
    expect(kindFilters[0][1]).not.toBe('highlight')
    expect(kindFilters[0][1]).not.toBe('full_match')
  })

  it('renders a ready reel as a video tile with a floored duration', async () => {
    videoRows = [READY_REEL]
    render(<GalleryManager mode="profile" entityId="user-1" readOnly />)

    expect(await screen.findByText('Video')).toBeInTheDocument()
    // 36.8s floors to 0:36 — never rounds up to 0:37.
    expect(screen.getByText('0:36')).toBeInTheDocument()
  })

  it('hides a still-processing reel from visitors', async () => {
    videoRows = [{ ...READY_REEL, status: 'processing' }]
    render(<GalleryManager mode="profile" entityId="user-1" readOnly />)

    await waitFor(() => {
      expect(queries.some((q) => q.table === 'player_videos')).toBe(true)
    })
    expect(screen.queryByText('Video')).not.toBeInTheDocument()
    expect(screen.queryByText('Processing…')).not.toBeInTheDocument()
  })

  it('never touches player_videos for a club gallery', async () => {
    render(<GalleryManager mode="club" entityId="club-1" readOnly />)

    await waitFor(() => {
      expect(queries.some((q) => q.table === 'club_media')).toBe(true)
    })
    expect(queries.some((q) => q.table === 'player_videos')).toBe(false)
  })

  it('reports only the PHOTO count to the parent (profile strength)', async () => {
    videoRows = [READY_REEL]
    photoRows = []
    const onCountChange = vi.fn()
    render(<GalleryManager mode="profile" entityId="user-1" readOnly onCountChange={onCountChange} />)

    await waitFor(() => expect(onCountChange).toHaveBeenCalled())
    expect(onCountChange).toHaveBeenLastCalledWith(0)
  })
})
