/**
 * Release audit 2026-10-05 · "Recruiters only" honoured on the phone.
 *
 * The owner's legacy linked highlight (profiles.highlight_video_url) has a
 * visibility switch (profiles.highlight_visibility). Desktop MediaTab gates
 * it (`canViewVideo`): owner always, everyone when public, recruiters only
 * when recruiters-only. The phone profile (ProfileLongScroll) and the Videos
 * screen rendered the link to every viewer. Both now share the desktop rule
 * and show a locked tile to a viewer who may not watch.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  viewer: { id: 'viewer-1', role: 'player', coach_recruits_for_team: null } as Record<string, unknown> | null,
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const s = { user: h.viewer ? { id: h.viewer.id } : null, profile: h.viewer }
    return sel ? sel(s) : s
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({}) }), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@/hooks/useProfileVideos', () => ({ useProfileVideos: () => ({ videos: [], links: [], loading: false, reload: vi.fn() }) }))
vi.mock('@/hooks/useVideoAccessSummary', () => ({ useVideoAccessSummary: () => ({ lockedFullMatches: 0, lockedHighlights: 0 }) }))
vi.mock('@/hooks/useProfileScrollData', () => ({
  useProfileScrollData: () => ({ loading: false, highlights: [], fullMatches: [], fullGameLinks: [], reels: [], career: [], photos: [], photoCount: 0, posts: [], postCount: 0, refresh: vi.fn() }),
}))
vi.mock('@/hooks/useTrustedReferences', () => ({ useTrustedReferences: () => ({ acceptedReferences: [], loading: false }) }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/components/home/MediaLightbox', () => ({ MediaLightbox: () => null }))
vi.mock('@/components/home/PostComposerModal', () => ({ PostComposerModal: () => null }))

import { canViewLinkedHighlight } from '@/lib/recruiter'
import VideosScreen from '@/components/profile/mobile/VideosScreen'
import ProfileLongScroll from '@/components/profile/mobile/ProfileLongScroll'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

const URL = 'https://www.youtube.com/watch?v=abc123'
const playerProfile = (highlight_visibility: string | null) =>
  ({ id: 'p1', role: 'player', full_name: 'Val Turienzo', avatar_url: null, highlight_video_url: URL, highlight_visibility, full_match_visibility: 'public' }) as unknown as PlayerProfileShape

const PLAYER = { id: 'viewer-1', role: 'player', coach_recruits_for_team: null }
const CLUB = { id: 'viewer-1', role: 'club', coach_recruits_for_team: null }
const RECRUITING_COACH = { id: 'viewer-1', role: 'coach', coach_recruits_for_team: true }
const PLAIN_COACH = { id: 'viewer-1', role: 'coach', coach_recruits_for_team: false }

beforeEach(() => {
  h.viewer = PLAYER
})

describe('canViewLinkedHighlight (the desktop MediaTab rule, shared)', () => {
  it('the owner always sees it', () => {
    expect(canViewLinkedHighlight({ owner: true, profile: { highlight_visibility: 'recruiters' }, viewer: null })).toBe(true)
  })
  it('public (or unset) is visible to everyone, signed in or not', () => {
    for (const v of ['public', null, undefined, 'anything-else']) {
      expect(canViewLinkedHighlight({ owner: false, profile: { highlight_visibility: v }, viewer: null }), String(v)).toBe(true)
      expect(canViewLinkedHighlight({ owner: false, profile: { highlight_visibility: v }, viewer: PLAYER }), String(v)).toBe(true)
    }
  })
  it('recruiters-only: clubs and recruiting coaches yes; players, plain coaches and guests no', () => {
    const p = { highlight_visibility: 'recruiters' }
    expect(canViewLinkedHighlight({ owner: false, profile: p, viewer: CLUB })).toBe(true)
    expect(canViewLinkedHighlight({ owner: false, profile: p, viewer: RECRUITING_COACH })).toBe(true)
    expect(canViewLinkedHighlight({ owner: false, profile: p, viewer: PLAYER })).toBe(false)
    expect(canViewLinkedHighlight({ owner: false, profile: p, viewer: PLAIN_COACH })).toBe(false)
    expect(canViewLinkedHighlight({ owner: false, profile: p, viewer: null })).toBe(false)
  })
})

describe('Videos screen (phone)', () => {
  const mount = (visibility: string | null, mode: 'own' | 'public') =>
    render(<MemoryRouter><VideosScreen profile={playerProfile(visibility)} mode={mode} onBack={() => {}} /></MemoryRouter>)

  it('a player viewer gets a locked tile, not the link, when it is recruiters-only', () => {
    mount('recruiters', 'public')
    expect(screen.queryByRole('link', { name: /linked highlight/i })).toBeNull()
    expect(screen.getByTestId('locked-video-tile')).toHaveAccessibleName(/Highlight — for clubs & recruiting coaches only/)
    expect(screen.getByText('Videos · 1')).toBeInTheDocument()
  })
  it('a club sees the link when it is recruiters-only', () => {
    h.viewer = CLUB
    mount('recruiters', 'public')
    expect(screen.getByRole('link', { name: /linked highlight/i })).toHaveAttribute('href', URL)
    expect(screen.queryByTestId('locked-video-tile')).toBeNull()
  })
  it('a recruiting coach sees it; a coach who does not recruit does not', () => {
    h.viewer = RECRUITING_COACH
    const a = mount('recruiters', 'public')
    expect(a.getByRole('link', { name: /linked highlight/i })).toBeInTheDocument()
    a.unmount()
    h.viewer = PLAIN_COACH
    mount('recruiters', 'public')
    expect(screen.queryByRole('link', { name: /linked highlight/i })).toBeNull()
    expect(screen.getByTestId('locked-video-tile')).toBeInTheDocument()
  })
  it('public stays visible to a player viewer', () => {
    mount('public', 'public')
    expect(screen.getByRole('link', { name: /linked highlight/i })).toBeInTheDocument()
  })
  it('the owner always sees their own link', () => {
    mount('recruiters', 'own')
    expect(screen.getByRole('link', { name: /linked highlight/i })).toBeInTheDocument()
  })
})

describe('Profile long scroll (phone)', () => {
  const noop = () => {}
  const mount = (visibility: string | null, readOnly: boolean) =>
    render(
      <MemoryRouter>
        <ProfileLongScroll profile={playerProfile(visibility)} readOnly={readOnly} onEdit={noop} onOpenVideos={noop} onManageVideos={noop} onOpenReferences={noop} onOpenReference={noop} onOpenCareer={noop} onOpenPhotos={noop} onOpenPosts={noop} onOpenFriends={noop} />
      </MemoryRouter>,
    )

  it('a player viewer gets a locked tile instead of the link when recruiters-only', () => {
    mount('recruiters', true)
    expect(screen.queryByTestId('linked-highlight')).toBeNull()
    expect(screen.getByTestId('locked-video-tile')).toBeInTheDocument()
  })
  it('a club gets the link when recruiters-only', () => {
    h.viewer = CLUB
    mount('recruiters', true)
    expect(screen.getByTestId('linked-highlight')).toHaveAttribute('href', URL)
    expect(screen.queryByTestId('locked-video-tile')).toBeNull()
  })
  it('public is visible to a player viewer; the owner always sees it', () => {
    const a = mount('public', true)
    expect(a.getByTestId('linked-highlight')).toBeInTheDocument()
    a.unmount()
    mount('recruiters', false)
    expect(screen.getByTestId('linked-highlight')).toBeInTheDocument()
  })
})
