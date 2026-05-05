import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { FullGameVideo } from '@/hooks/useFullGameVideos'

// ── Hook mock — control what useFullGameVideos returns per test.
const mockUseFullGameVideos = vi.fn()
vi.mock('@/hooks/useFullGameVideos', () => ({
  useFullGameVideos: (...args: unknown[]) => mockUseFullGameVideos(...args),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

// Stub the form modal so we don't pull in the supabase chain.
vi.mock('@/components/FullGameVideoFormModal', () => ({
  default: () => null,
}))

vi.mock('@/components/ConfirmActionModal', () => ({
  default: () => null,
}))

import FullGameVideosSection from '@/components/FullGameVideosSection'

const baseVideo: FullGameVideo = {
  id: 'v-1',
  user_id: 'player-1',
  video_url: 'https://www.youtube.com/watch?v=match1',
  match_title: 'Cup quarter-final',
  match_date: '2026-03-15',
  competition: 'Hoofdklasse',
  player_team: 'AHC Amsterdam',
  opponent_team: 'HC Bloemendaal',
  position_played: 'Midfielder',
  shirt_number: 8,
  minutes_played: 70,
  visibility: 'public',
  notes: null,
  display_order: 0,
  created_at: '2026-03-16T10:00:00Z',
  updated_at: '2026-03-16T10:00:00Z',
}

beforeEach(() => {
  mockUseFullGameVideos.mockReset()
})

describe('FullGameVideosSection', () => {
  it('renders the owner empty state with the action-oriented copy', () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    render(<FullGameVideosSection playerUserId="player-1" />)

    expect(screen.getByText('No match videos yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Add full match footage so clubs can evaluate you in real game conditions/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add video/i })).toBeInTheDocument()
  })

  it('hides the entire section in readOnly mode when there are zero videos', () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    const { container } = render(<FullGameVideosSection playerUserId="player-1" readOnly />)

    // No header, no empty state, no add CTA — visitor sees nothing.
    expect(container.firstChild).toBeNull()
  })

  it('renders the section with neutral subtitle in readOnly mode when videos exist', () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [baseVideo],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    render(<FullGameVideosSection playerUserId="player-1" readOnly />)

    // Header + neutral subtitle present
    expect(screen.getByText('Full match footage')).toBeInTheDocument()
    expect(screen.getByText(/Unedited match videos for deeper context/i)).toBeInTheDocument()
    // Owner affordances absent
    expect(screen.queryByRole('button', { name: /add video/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit video/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove video/i })).not.toBeInTheDocument()
    // Watch link still present so visitors can open the video
    expect(screen.getByRole('link', { name: /watch video/i })).toBeInTheDocument()
  })

  it('renders match title, opponent line, context line, and player line for a complete row', async () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [baseVideo],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    render(<FullGameVideosSection playerUserId="player-1" />)

    await waitFor(() => {
      expect(screen.getByText('Cup quarter-final')).toBeInTheDocument()
      expect(screen.getByText('AHC Amsterdam vs HC Bloemendaal')).toBeInTheDocument()
    })
    // Context line: "Hoofdklasse · Mar 2026"
    expect(screen.getByText(/Hoofdklasse/)).toBeInTheDocument()
    expect(screen.getByText(/Mar 2026/)).toBeInTheDocument()
    // Player line: "Position: Midfielder · Shirt #8 · 70 minutes"
    expect(screen.getByText(/Position: Midfielder/)).toBeInTheDocument()
    expect(screen.getByText(/Shirt #8/)).toBeInTheDocument()
    expect(screen.getByText(/70 minutes/)).toBeInTheDocument()
    // Watch link points to the canonical URL with target=_blank
    const link = screen.getByRole('link', { name: /watch video/i }) as HTMLAnchorElement
    expect(link.href).toBe('https://www.youtube.com/watch?v=match1')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('shows the "Recruiters only" badge when visibility=recruiters', () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [{ ...baseVideo, visibility: 'recruiters' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    render(<FullGameVideosSection playerUserId="player-1" />)

    expect(screen.getByText(/Recruiters only/i)).toBeInTheDocument()
  })

  it('renders nothing for the missing-everything edge case (no opponent, no context, no player line)', () => {
    mockUseFullGameVideos.mockReturnValue({
      videos: [
        {
          ...baseVideo,
          match_date: null,
          competition: null,
          player_team: null,
          opponent_team: null,
          position_played: null,
          shirt_number: null,
          minutes_played: null,
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      addVideo: vi.fn(),
      updateVideo: vi.fn(),
      deleteVideo: vi.fn(),
    })

    render(<FullGameVideosSection playerUserId="player-1" />)

    // Match title still renders even when everything else is null.
    expect(screen.getByText('Cup quarter-final')).toBeInTheDocument()
    // None of the optional context lines should appear.
    expect(screen.queryByText(/Position:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Shirt #/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Hoofdklasse/)).not.toBeInTheDocument()
  })
})
