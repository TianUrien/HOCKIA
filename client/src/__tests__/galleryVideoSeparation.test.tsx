import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
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
  updatePayload: Record<string, unknown> | null
}

const queries: QueryRecord[] = []
let photoRows: unknown[] = []
let videoRows: unknown[] = []

function makeBuilder(table: string) {
  const record: QueryRecord = { table, eqs: [], updatePayload: null }
  queries.push(record)

  const rows = () => (table === 'player_videos' ? videoRows : photoRows)

  const builder = {
    select: () => builder,
    update: (payload: Record<string, unknown>) => {
      record.updatePayload = payload
      return builder
    },
    eq: (column: string, value: unknown) => {
      record.eqs.push([column, value])
      return builder
    },
    order: () => builder,
    // Thenable so `await` / Promise.all resolve it like a real PostgrestBuilder.
    // Updates resolve non-empty (the RLS-rejection check needs a row back).
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: record.updatePayload ? [{ id: 'updated' }] : rows(), error: null }),
  }
  return builder
}

/** The global test shim's IntersectionObserver never fires. VideoTile mints
 *  its thumbnail only when the tile nears the viewport, so most tests need an
 *  observer that reports "visible" immediately. */
function stubAutoFiringObserver() {
  vi.stubGlobal('IntersectionObserver', class {
    cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
    }
    observe() {
      this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
}

// VideoTile awaits functions.invoke for its signed thumbnail; default = no
// thumbnail (branded fallback). Tests override per-case.
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    functions: { invoke: invokeMock },
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
// `upload` is hoisted-stable so the upload-path test can assert on its args.
const uploadHookMocks = vi.hoisted(() => ({
  upload: vi.fn().mockResolvedValue('video-9'),
}))
vi.mock('@/hooks/useNativeVideoUpload', () => ({
  useNativeVideoUpload: () => ({
    phase: 'idle',
    progress: 0,
    error: null,
    upload: uploadHookMocks.upload,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/lib/imageOptimization', () => ({
  validateImage: vi.fn().mockReturnValue({ valid: true }),
  validateVideoFull: vi.fn().mockResolvedValue({ valid: true, duration: 30, width: 640, height: 480 }),
  optimizeImage: vi.fn(async (f: File) => f),
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
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ data: null, error: null })
  stubAutoFiringObserver()
})

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('uploads a Gallery video as kind=reel, visibility=public (never post/highlight)', async () => {
    uploadHookMocks.upload.mockClear()

    // Owner view: entityId matches the mocked auth user.
    render(<GalleryManager mode="profile" entityId="user-1" />)

    const input = await screen.findByLabelText('Upload video')
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'training.mp4', { type: 'video/mp4' })] },
    })

    await waitFor(() => expect(uploadHookMocks.upload).toHaveBeenCalled())
    const [, opts] = uploadHookMocks.upload.mock.calls[0]
    // The fence on the WRITE path: a Gallery upload is always a reel.
    expect(opts).toMatchObject({ kind: 'reel', visibility: 'public' })

    // And the new reel is seated at the TOP of the (empty) gallery: the
    // display_order write happens and targets the uploaded video.
    await waitFor(() => {
      const orderWrite = queries.find(
        (q) => q.table === 'player_videos' && q.updatePayload && 'display_order' in q.updatePayload,
      )
      expect(orderWrite).toBeDefined()
      expect(orderWrite!.updatePayload).toMatchObject({ display_order: 0 })
      expect(orderWrite!.eqs).toContainEqual(['id', 'video-9'])
    })
  })

  it('shows the gallery NEWEST-FIRST (higher order value wins; created_at breaks ties)', async () => {
    photoRows = [
      { id: 'p-old', user_id: 'user-1', photo_url: 'https://x/old.jpg', file_name: 'old.jpg', file_size: 1, caption: 'OLDEST-PHOTO', alt_text: null, order_index: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'p-new', user_id: 'user-1', photo_url: 'https://x/new.jpg', file_name: 'new.jpg', file_size: 1, caption: 'NEWEST-PHOTO', alt_text: null, order_index: 5, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
    ]
    // The video sits between them in the order space.
    videoRows = [{ ...READY_REEL, id: 'video-mid', display_order: 3, description: 'MIDDLE-VIDEO' }]

    const { container } = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await screen.findByText('NEWEST-PHOTO')

    const text = container.textContent ?? ''
    expect(text.indexOf('NEWEST-PHOTO')).toBeGreaterThan(-1)
    expect(text.indexOf('NEWEST-PHOTO')).toBeLessThan(text.indexOf('MIDDLE-VIDEO'))
    expect(text.indexOf('MIDDLE-VIDEO')).toBeLessThan(text.indexOf('OLDEST-PHOTO'))
  })

  it('renders the signed Cloudflare thumbnail on a video tile automatically', async () => {
    invokeMock.mockResolvedValue({
      data: { thumbnail: 'https://videodelivery.net/tok-abc/thumbnails/thumbnail.jpg' },
      error: null,
    })
    videoRows = [{ ...READY_REEL, id: 'video-thumb' }]

    const { container } = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await screen.findByText('Video')

    await waitFor(() => {
      const img = container.querySelector('img[src="https://videodelivery.net/tok-abc/thumbnails/thumbnail.jpg"]')
      expect(img).not.toBeNull()
    })
    expect(invokeMock).toHaveBeenCalledWith('video-playback-token', { body: { videoId: 'video-thumb' } })
  })

  it('persists a manual reorder as REVERSE indexes (top of grid = highest value)', async () => {
    // Displayed A(5), B(3), C(0). Reverting persistOrder to ascending indexes
    // would reverse every gallery on the next fetch while all other tests stay
    // green — this test exists to kill exactly that mutation.
    const base = { user_id: 'user-1', file_size: 1, alt_text: null, updated_at: '2026-05-01T00:00:00.000Z' }
    photoRows = [
      { ...base, id: 'a-id', photo_url: 'https://x/a.jpg', file_name: 'a.jpg', caption: 'A', order_index: 5, created_at: '2026-05-03T00:00:00.000Z' },
      { ...base, id: 'b-id', photo_url: 'https://x/b.jpg', file_name: 'b.jpg', caption: 'B', order_index: 3, created_at: '2026-05-02T00:00:00.000Z' },
      { ...base, id: 'c-id', photo_url: 'https://x/c.jpg', file_name: 'c.jpg', caption: 'C', order_index: 0, created_at: '2026-05-01T00:00:00.000Z' },
    ]

    // Owner view (entityId === mocked user id, not readOnly) → arrows render.
    render(<GalleryManager mode="profile" entityId="user-1" />)
    await screen.findByText('C')

    // Move B (displayed 2nd) up → displayed becomes [B, A, C].
    fireEvent.click(screen.getAllByText('Move item earlier')[1])

    await waitFor(() => {
      const writes = queries.filter((q) => q.updatePayload && 'order_index' in q.updatePayload)
      expect(writes).toHaveLength(3)
    })

    const written = Object.fromEntries(
      queries
        .filter((q) => q.updatePayload && 'order_index' in q.updatePayload)
        .map((q) => [q.eqs.find(([c]) => c === 'id')?.[1], q.updatePayload!.order_index]),
    )
    expect(written).toEqual({ 'b-id': 2, 'a-id': 1, 'c-id': 0 })
  })

  it('does NOT mint a thumbnail for tiles that never enter the viewport', async () => {
    // Replace the auto-firing observer with an inert one (like offscreen tiles).
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    videoRows = [{ ...READY_REEL, id: 'video-offscreen' }]

    render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await screen.findByText('Video')

    expect(invokeMock).not.toHaveBeenCalledWith('video-playback-token', expect.anything())
  })

  it('recovers from an expired signed thumbnail by minting a fresh one', async () => {
    invokeMock
      .mockResolvedValueOnce({ data: { thumbnail: 'https://videodelivery.net/tok-old/thumbnails/thumbnail.jpg' }, error: null })
      .mockResolvedValueOnce({ data: { thumbnail: 'https://videodelivery.net/tok-new/thumbnails/thumbnail.jpg' }, error: null })
    videoRows = [{ ...READY_REEL, id: 'video-expiry' }]

    const { container } = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await waitFor(() => {
      expect(container.querySelector('img[src*="tok-old"]')).not.toBeNull()
    })

    // The signed URL expired (~1h TTL) — the <img> errors.
    fireEvent.error(container.querySelector('img[src*="tok-old"]')!)

    // A fresh token is minted once; the tile recovers instead of degrading.
    await waitFor(() => {
      expect(container.querySelector('img[src*="tok-new"]')).not.toBeNull()
    })
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('renders ties (same order value, same timestamp) deterministically by id', async () => {
    const tie = { user_id: 'user-1', file_size: 1, alt_text: null, order_index: 0, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z' }
    photoRows = [
      { ...tie, id: 'b-photo', photo_url: 'https://x/b.jpg', file_name: 'b.jpg', caption: 'TIE-B' },
      { ...tie, id: 'a-photo', photo_url: 'https://x/a.jpg', file_name: 'a.jpg', caption: 'TIE-A' },
    ]

    const first = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await first.findByText('TIE-A')
    const order1 = (first.container.textContent ?? '').indexOf('TIE-A') < (first.container.textContent ?? '').indexOf('TIE-B')
    first.unmount()

    // Same data arriving in the opposite row order must render identically.
    photoRows = [photoRows[1], photoRows[0]]
    const second = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await second.findByText('TIE-A')
    const order2 = (second.container.textContent ?? '').indexOf('TIE-A') < (second.container.textContent ?? '').indexOf('TIE-B')

    expect(order1).toBe(order2)
    expect(order1).toBe(true) // id tiebreak: 'a-photo' < 'b-photo'
  })

  it('falls back to the branded tile when no thumbnail can be minted', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'nope' } })
    videoRows = [{ ...READY_REEL, id: 'video-nothumb' }]

    const { container } = render(<GalleryManager mode="profile" entityId="user-1" readOnly />)
    await screen.findByText('Video')

    // Play button + badges still render; no signed <img> appears.
    expect(screen.getByText('0:36')).toBeInTheDocument()
    expect(container.querySelector('img[src*="videodelivery"]')).toBeNull()
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
