/**
 * Manage media (Figma 145:758): the full-match empty slot is a dashed
 * brand-soft card with the short copy; "Add photo" is a Secondary button; the
 * section actions are links.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    functions: { invoke: vi.fn() },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

const media = vi.hoisted(() => ({
  videos: [] as unknown[],
  photos: [{ id: 'p1', url: 'https://example.com/1.jpg', caption: null }, { id: 'p2', url: 'https://example.com/2.jpg', caption: null }] as unknown[],
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => { const s = { profile: { id: 'u1', role: 'player', highlight_video_url: null, full_match_visibility: 'recruiters' }, refreshProfile: vi.fn() }; return selector ? selector(s) : s },
}))
vi.mock('@/lib/toast', () => ({ useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }) }))
vi.mock('@/hooks/useProfileVideos', () => ({ useProfileVideos: () => ({ videos: media.videos, links: [], loading: false, reload: vi.fn() }) }))
vi.mock('@/hooks/useFullGameVideos', () => ({ useFullGameVideos: () => ({ videos: [], isLoading: false, error: null, refetch: vi.fn(), addVideo: vi.fn(), updateVideo: vi.fn(), deleteVideo: vi.fn() }) }))
vi.mock('@/hooks/useGalleryPhotos', () => ({ useGalleryPhotos: () => ({ photos: media.photos, loading: false, busy: false, add: vi.fn(), remove: vi.fn(), reorder: vi.fn() }) }))
vi.mock('@/hooks/useProfileScrollData', () => ({ clearProfileScrollCache: vi.fn() }))
vi.mock('@/components/media/UploadVideoModal', () => ({ default: () => null }))
vi.mock('@/components/FullGameVideoFormModal', () => ({ default: () => null }))
vi.mock('@/components/home/MediaLightbox', () => ({ MediaLightbox: () => null }))
vi.mock('@/components/ConfirmActionModal', () => ({ default: () => null }))
vi.mock('@/components/profile/mobile/ProfileVideoTile', () => ({ ProfileVideoTile: () => <div data-testid="video-tile" /> }))

import ManageMediaScreen from '@/components/profile/mobile/ManageMediaScreen'

const renderScreen = () => render(<MemoryRouter><ManageMediaScreen profileId="u1" onBack={vi.fn()} /></MemoryRouter>)

describe('ManageMediaScreen', () => {
  it('nav title is "Media"', () => {
    renderScreen()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Media')
  })

  it('the full-match empty slot: dashed brand-soft card, upload icon, exact copy', () => {
    renderScreen()
    const slot = screen.getByTestId('media-full-match-empty')
    expect(slot.className).toContain('border-dashed')
    expect(slot.className).toContain('bg-brand-soft')
    expect(slot.querySelector('svg.lucide-upload')).not.toBeNull()
    expect(slot.textContent).toBe('Upload a full match60+ minutes, any quality. It’s the first thing clubs ask for.')
  })

  it('"Add photo" is a Secondary button; Reorder is a link', () => {
    renderScreen()
    const add = screen.getByTestId('media-add-photo')
    expect(add.textContent).toBe('Add photo')
    expect(add.className).toContain('ring-line')
    expect(add.className).not.toContain('bg-hockia-primary')
    const reorder = screen.getByRole('button', { name: 'Reorder' })
    expect(reorder.className).toContain('text-hockia-primary')
    expect(reorder.className).not.toContain('bg-')
  })

  it('the photo grid keeps the owner order it was given', () => {
    renderScreen()
    expect(screen.getByText('Photos · 2')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Photo \d$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Photo 1', 'Photo 2'])
  })

  it('the slot gives way once a full match exists', () => {
    media.videos = [{ id: 'v1', kind: 'full_match', title: 'vs CASI', durationSeconds: 4200, visibility: 'recruiters' }]
    renderScreen()
    expect(screen.queryByTestId('media-full-match-empty')).toBeNull()
    media.videos = []
  })
})
