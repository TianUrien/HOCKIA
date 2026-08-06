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
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
    <MemoryRouter>
      <MediaAddedCard item={{ ...item, ...overrides }} />
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
