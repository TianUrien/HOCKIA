/**
 * media_added card — dead-tile regression (prod incident 2026-08-07).
 *
 * A rollup card whose sample photos were deleted after upload rendered
 * broken-image glyphs on Home. The DB now prunes sample_urls on photo
 * delete (migration 20260807100000), but a dead URL can still reach the
 * client (CDN caching races, historical items), so the card must also
 * degrade gracefully: a tile that fails to load DROPS OUT of the grid
 * instead of showing the browser's broken-image icon.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The @/components barrel transitively imports lib/supabase, which throws at
// import time without env vars — CI's unit job has none (locally they come
// from the gitignored root .env.local). Same lesson as
// recruiterCandidateCardAvatar.test.tsx.
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
        : () => chain,
  })
  return { supabase: { from: () => chain, rpc: () => chain, auth: { getSession: async () => ({ data: { session: null }, error: null }) } } }
})

// The full set behind the card (fetched when the viewer opens) is driven by
// the test: undefined = still loading.
const fullSet = vi.hoisted(() => ({ data: undefined as string[] | undefined, enabledCalls: [] as boolean[] }))
vi.mock('@/hooks/useActivityPhotos', () => ({
  useActivityPhotos: (_u: string, _d: string, enabled: boolean) => {
    fullSet.enabledCalls.push(enabled)
    return { data: enabled ? fullSet.data : undefined }
  },
}))

import { MediaAddedCard } from '@/components/home/cards/MediaAddedCard'
import type { MediaAddedFeedItem } from '@/types/homeFeed'

const item: MediaAddedFeedItem = {
  feed_item_id: 'f1',
  item_type: 'media_added',
  created_at: new Date().toISOString(),
  uploader_id: 'u1',
  uploader_name: 'Addae Godsway Kwadjo',
  uploader_role: 'player',
  uploader_avatar_url: null,
  media_kind: 'photo',
  day: '2026-08-05',
  count: 3,
  sample_urls: [
    'https://x.supabase.co/storage/v1/object/public/gallery/u1/a.jpeg',
    'https://x.supabase.co/storage/v1/object/public/gallery/u1/b.jpeg',
    'https://x.supabase.co/storage/v1/object/public/gallery/u1/c.jpeg',
  ],
  last_added_at: new Date().toISOString(),
}

const tileImgs = (container: HTMLElement) =>
  // Tile images live inside the aspect-square grid cells; the header Avatar
  // does not use that wrapper.
  Array.from(container.querySelectorAll('.aspect-square img'))

function renderCard(overrides: Partial<MediaAddedFeedItem> = {}) {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<MediaAddedCard item={{ ...item, ...overrides }} />} />
        <Route path="*" element={<p>left home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MediaAddedCard dead tiles', () => {
  it('renders all sample tiles while they load fine', () => {
    const { container } = renderCard()
    expect(tileImgs(container)).toHaveLength(3)
  })

  it('drops a tile whose image fails, keeping the rest', () => {
    const { container } = renderCard()
    fireEvent.error(tileImgs(container)[1])
    expect(tileImgs(container)).toHaveLength(2)
  })

  it('removes the grid entirely when every sample is dead (the incident)', () => {
    const { container } = renderCard()
    // All three URLs 404 (photos deleted after upload). Re-query between
    // errors — each failure re-renders the grid and replaces the nodes.
    let imgs = tileImgs(container)
    let guard = 10
    while (imgs.length > 0 && guard-- > 0) {
      fireEvent.error(imgs[0])
      imgs = tileImgs(container)
    }
    expect(tileImgs(container)).toHaveLength(0)
    expect(container.querySelector('.grid')).toBeNull()
  })
})

describe('MediaAddedCard photo viewer (Home)', () => {
  const many = Array.from({ length: 19 }, (_, i) => `https://x.supabase.co/storage/v1/object/public/gallery/u1/p${i}.jpeg`)
  const nineteen = { count: 19, sample_urls: many.slice(0, 4) }

  it('tapping a photo opens the viewer on that photo and never leaves Home', () => {
    fullSet.data = undefined
    renderCard(nineteen)
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2 of 19' }))
    expect(screen.queryByText('left home')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('2 of 4')).toBeInTheDocument() // samples until the full set loads
  })

  it('the +N tile opens the viewer and the full set lets you browse all N', () => {
    fullSet.data = many
    renderCard(nineteen)
    expect(screen.getByText('+15')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View all 19 photos' }))
    expect(screen.getByText('4 of 19')).toBeInTheDocument()
  })

  it('loads the full set only once the viewer is open', () => {
    fullSet.enabledCalls = []
    renderCard(nineteen)
    expect(fullSet.enabledCalls.every((e) => e === false)).toBe(true)
  })

  it('closing returns to the card', () => {
    fullSet.data = many
    renderCard(nineteen)
    fireEvent.click(screen.getByRole('button', { name: 'View photo 1 of 19' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'View photo 1 of 19' })).toBeInTheDocument()
  })

  it('the profile stays on the name / avatar link', () => {
    renderCard(nineteen)
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.includes('u1'))).toBe(true)
  })
})
