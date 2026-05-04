import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PulseItem } from '@/hooks/useMyPulse'

// ── react-router mock — capture navigate calls so we can assert routing.
const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

// ── auth-store mock — only profile.role + profile.username are read.
let mockProfile: { role: string; username: string } | null = {
  role: 'player',
  username: 'tian',
}
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector: (state: { profile: typeof mockProfile }) => unknown) =>
    selector({ profile: mockProfile }),
}))

import { SnapshotGainCelebrationCard } from '@/components/home/SnapshotGainCelebrationCard'

const buildItem = (metadata: Record<string, unknown>, overrides: Partial<PulseItem> = {}): PulseItem => ({
  id: 'pulse-1',
  user_id: 'user-1',
  item_type: 'snapshot_gain_celebration',
  priority: 2,
  metadata: metadata as PulseItem['metadata'],
  created_at: '2026-05-04T10:00:00.000Z',
  seen_at: null,
  clicked_at: null,
  action_completed_at: null,
  dismissed_at: null,
  ...overrides,
})

beforeEach(() => {
  navigateMock.mockClear()
  mockProfile = { role: 'player', username: 'tian' }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SnapshotGainCelebrationCard — per-signal copy', () => {
  it('renders first_reference card with endorser name', () => {
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({
          signal: 'first_reference',
          endorser_name: 'Maria Sosa',
          endorser_role: 'coach',
        })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('First reference accepted')).toBeInTheDocument()
    expect(screen.getByText(/Maria Sosa endorsed your profile/)).toBeInTheDocument()
  })

  it('falls back to a generic subtitle when endorser_name is missing', () => {
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_reference' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText(/A coach or peer endorsed your profile/)).toBeInTheDocument()
  })

  it('renders first_highlight_video card', () => {
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_highlight_video' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('Highlight video added')).toBeInTheDocument()
    expect(screen.getByText(/shows recruiters how you actually play/)).toBeInTheDocument()
  })

  it('renders first_career_entry card with club_name', () => {
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_career_entry', club_name: 'AHC Amsterdam' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('First career entry added')).toBeInTheDocument()
    expect(screen.getByText(/AHC Amsterdam is now part of your career history/)).toBeInTheDocument()
  })

  it('renders first_world_club_link card with club_name', () => {
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_world_club_link', club_name: 'HC Bloemendaal' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('Club connection verified')).toBeInTheDocument()
    expect(screen.getByText(/linked to HC Bloemendaal/)).toBeInTheDocument()
  })

  it('renders nothing for an unknown signal value (defensive)', () => {
    const { container } = render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'mystery_signal' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when metadata.signal is missing entirely', () => {
    const { container } = render(
      <SnapshotGainCelebrationCard
        item={buildItem({})}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('SnapshotGainCelebrationCard — interactions', () => {
  it('calls onClick + navigates to player snapshot when "View snapshot" is tapped', () => {
    const onClick = vi.fn()
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_highlight_video' })}
        onClick={onClick}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View snapshot' }))
    expect(onClick).toHaveBeenCalledWith('pulse-1')
    expect(navigateMock).toHaveBeenCalledWith('/players/tian')
  })

  it('routes to /coaches/{username} when the user is a coach', () => {
    mockProfile = { role: 'coach', username: 'jordi' }
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_highlight_video' })}
        onClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View snapshot' }))
    expect(navigateMock).toHaveBeenCalledWith('/coaches/jordi')
  })

  it('still calls onClick when role is unknown (no navigation, but the click is recorded)', () => {
    mockProfile = null
    const onClick = vi.fn()
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_highlight_video' })}
        onClick={onClick}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View snapshot' }))
    expect(onClick).toHaveBeenCalledWith('pulse-1')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('calls onDismiss when the X button is tapped', () => {
    const onDismiss = vi.fn()
    render(
      <SnapshotGainCelebrationCard
        item={buildItem({ signal: 'first_highlight_video' })}
        onClick={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('pulse-1')
  })
})
