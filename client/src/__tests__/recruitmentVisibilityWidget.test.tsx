/**
 * RecruitmentVisibilityWidget — role-aware checklist contract.
 *
 * Locks in:
 *   - Player mode renders the 5 player items + queries career_history
 *     once for the Representative-team row
 *   - Coach mode renders the 5 coach items + skips the career_history
 *     query entirely (career_entry_count is denormalized)
 *   - Completed items render an "Added" badge; incomplete items render
 *     the action button
 *   - "X of 5 added" headline reflects the actual completion count
 *   - Clicking an action button dispatches onAction with the matching
 *     bucket id (so PlayerDashboard / CoachDashboard's existing
 *     handleProfileStrengthAction routes correctly)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Profile } from '@/lib/supabase'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'

// ── Supabase mock — count-style thenable for the career_history query.
// Toggle `repTeamCount` per test so we can drive the player's
// Representative-team row to completed or not.
const repTeamState = { count: 0 }
const supabaseFromSpy = vi.fn()
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: null; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: null, count: repTeamState.count, error: null }).then(resolve),
  }
  return {
    supabase: {
      from: (...args: unknown[]) => {
        supabaseFromSpy(...args)
        return builder
      },
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import RecruitmentVisibilityWidget from '@/components/dashboard/bento/RecruitmentVisibilityWidget'

const basePlayer: Partial<Profile> = {
  id: 'player-1',
  role: 'player',
  highlight_video_url: null,
  full_game_video_count: 0,
  current_world_club_id: null,
  accepted_reference_count: 0,
  career_entry_count: 0,
  coach_specialization: null,
  coaching_categories: null,
}

const baseCoach: Partial<Profile> = {
  id: 'coach-1',
  role: 'coach',
  coach_specialization: null,
  coaching_categories: null,
  current_world_club_id: null,
  career_entry_count: 0,
  accepted_reference_count: 0,
}

function renderWidget(profile: Partial<Profile>, onAction = vi.fn()) {
  return {
    onAction,
    ...render(
      <RecruitmentVisibilityWidget
        profile={profile as Profile}
        onAction={onAction}
      />,
    ),
  }
}

describe('RecruitmentVisibilityWidget — player', () => {
  beforeEach(() => {
    repTeamState.count = 0
    supabaseFromSpy.mockClear()
  })

  it('renders the 5 player items with all rows incomplete by default', async () => {
    renderWidget(basePlayer)
    expect(screen.getByText('Highlight video')).toBeInTheDocument()
    expect(screen.getByText('Full match video')).toBeInTheDocument()
    expect(screen.getByText('Current club + league')).toBeInTheDocument()
    expect(screen.getByText('At least one reference')).toBeInTheDocument()
    expect(screen.getByText('Representative team')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/0 of 5 added/i)).toBeInTheDocument()
    })
    // Every action button should be present (none completed → no Added badges).
    expect(screen.queryAllByText('Added')).toHaveLength(0)
  })

  it('queries career_history exactly once for the Representative team row', async () => {
    renderWidget(basePlayer)
    await waitFor(() => {
      expect(supabaseFromSpy).toHaveBeenCalledWith('career_history')
    })
    expect(supabaseFromSpy).toHaveBeenCalledTimes(1)
  })

  it('counts completed items and marks rows with "Added" when fields are populated', async () => {
    repTeamState.count = 2
    renderWidget({
      ...basePlayer,
      highlight_video_url: 'https://example.com/v',
      full_game_video_count: 3,
      current_world_club_id: 'club-99',
      accepted_reference_count: 1,
    })
    // All-complete swaps the headline copy entirely (the component
    // intentionally avoids "5 of 5" when there's nothing left to add).
    await waitFor(() => {
      expect(
        screen.getByText(/your profile shows every signal recruiters look for/i),
      ).toBeInTheDocument()
    })
    expect(screen.getAllByText('Added')).toHaveLength(5)
  })

  it('partially-complete profile shows "X of 5 added" with the correct count', async () => {
    repTeamState.count = 0
    renderWidget({
      ...basePlayer,
      highlight_video_url: 'https://example.com/v',
      accepted_reference_count: 1,
    })
    await waitFor(() => {
      expect(screen.getByText(/2 of 5 added/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText('Added')).toHaveLength(2)
  })

  it('dispatches onAction with the highlight-video bucket when the Add button is clicked', async () => {
    const onAction = vi.fn<(bucket: ProfileStrengthBucket) => void>()
    renderWidget(basePlayer, onAction)
    await waitFor(() => {
      expect(screen.getByText(/0 of 5 added/i)).toBeInTheDocument()
    })

    // First incomplete row's button is "Add" (Highlight video).
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    await userEvent.click(addButtons[0])
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0][0].action).toEqual({ type: 'add-video' })
    expect(onAction.mock.calls[0][0].id).toBe('highlight-video')
  })
})

describe('RecruitmentVisibilityWidget — coach', () => {
  beforeEach(() => {
    repTeamState.count = 0
    supabaseFromSpy.mockClear()
  })

  it('renders the 5 coach items + headline without querying career_history', async () => {
    renderWidget(baseCoach)
    expect(screen.getByText('Coaching specialization')).toBeInTheDocument()
    expect(screen.getByText('Coaching categories')).toBeInTheDocument()
    expect(screen.getByText('Current club + league')).toBeInTheDocument()
    expect(screen.getByText('Coaching experience')).toBeInTheDocument()
    expect(screen.getByText('At least one reference')).toBeInTheDocument()

    expect(screen.getByText(/0 of 5 added/i)).toBeInTheDocument()
    // Coach path is fully derived from the profile row — no extra fetch.
    expect(supabaseFromSpy).not.toHaveBeenCalled()
  })

  it('marks rows complete from profile fields when present', () => {
    renderWidget({
      ...baseCoach,
      coach_specialization: 'head_coach',
      coaching_categories: ['adult_men'],
      current_world_club_id: 'club-1',
      career_entry_count: 4,
      accepted_reference_count: 2,
    })
    expect(
      screen.getByText(/your profile shows every signal recruiters look for/i),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Added')).toHaveLength(5)
  })

  it('dispatches onAction with the references bucket when the Request button is clicked', async () => {
    const onAction = vi.fn<(bucket: ProfileStrengthBucket) => void>()
    renderWidget(baseCoach, onAction)

    await userEvent.click(screen.getByRole('button', { name: 'Request' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0][0].id).toBe('references')
    expect(onAction.mock.calls[0][0].action).toEqual({ type: 'tab', tab: 'references' })
  })
})
