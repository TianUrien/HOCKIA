import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import type { MilestoneAchievedFeedItem } from '@/types/homeFeed'

// FeedCard reaches the Supabase client through useFeedAuthorContext; the CI
// unit job has no env vars, so the client must never be constructed here.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
  RoleBadge: ({ role }: { role?: string }) => <span data-testid="role-badge">{role}</span>,
  StorageImage: ({ onImageError, alt }: { onImageError?: () => void; alt: string; src?: string; className?: string; containerClassName?: string; fallbackClassName?: string }) => (
    <img data-testid="storage-image" alt={alt} onError={onImageError} />
  ),
}))

vi.mock('@/lib/utils', () => ({
  getTimeAgo: () => '2d ago',
}))

import { MilestoneCard } from '@/components/home/cards/MilestoneCard'

const baseMilestone: MilestoneAchievedFeedItem = {
  feed_item_id: 'ms-1',
  item_type: 'milestone_achieved',
  created_at: '2026-02-09T00:00:00Z',
  milestone_type: 'profile_100_percent',
  profile_id: 'p1',
  full_name: 'Test Player',
  avatar_url: null,
  role: 'player',
}

describe('MilestoneCard', () => {
  it('renders 100% completion milestone', () => {
    render(<MilestoneCard item={baseMilestone} />)

    expect(screen.getByText('Test Player')).toBeInTheDocument()
    expect(screen.getByText('Completed their profile')).toBeInTheDocument()
  })

  it('renders first_gallery_image milestone', () => {
    render(
      <MilestoneCard
        item={{ ...baseMilestone, milestone_type: 'first_gallery_image' }}
      />
    )

    expect(screen.getByText('Added their first gallery photos')).toBeInTheDocument()
  })

  it('renders first_reference_received milestone', () => {
    render(
      <MilestoneCard
        item={{ ...baseMilestone, milestone_type: 'first_reference_received' }}
      />
    )

    expect(screen.getByText('Received their first reference')).toBeInTheDocument()
  })

  it('links to correct profile path for player', () => {
    render(<MilestoneCard item={baseMilestone} />)

    const link = screen.getByText('Test Player').closest('a')
    expect(link).toHaveAttribute('href', '/players/id/p1?ref=feed')
  })

  it('links to correct profile path for club', () => {
    render(
      <MilestoneCard
        item={{ ...baseMilestone, role: 'club', full_name: 'Test FC' }}
      />
    )

    const link = screen.getByText('Test FC').closest('a')
    expect(link).toHaveAttribute('href', '/clubs/id/p1?ref=feed')
  })

  it('returns null for unknown milestone types', () => {
    const { container } = render(
      <MilestoneCard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item={{ ...baseMilestone, milestone_type: 'profile_60_percent' as any }}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('hides entire card when gallery image fails to load', () => {
    const { container } = render(
      <MilestoneCard
        item={{
          ...baseMilestone,
          milestone_type: 'first_gallery_image',
          image_url: 'https://broken-url.com/photo.jpg',
        }}
      />
    )

    // Card renders initially
    expect(screen.getByText('Added their first gallery photos')).toBeInTheDocument()

    // Simulate image load error
    fireEvent.error(screen.getByTestId('storage-image'))

    // Entire card should be gone
    expect(container.firstChild).toBeNull()
  })

})
