import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { MemberJoinedFeedItem, UserPostFeedItem, MilestoneAchievedFeedItem, HomeFeedItem } from '@/types/homeFeed'

// Mock all card components to isolate routing logic
vi.mock('@/components/home/cards', () => ({
  MemberJoinedCard: ({ item }: { item: MemberJoinedFeedItem }) => (
    <div data-testid="member-joined-card">{item.full_name}</div>
  ),
  OpportunityPostedCard: () => <div data-testid="opportunity-posted-card" />,
  MilestoneCard: ({ item }: { item: MilestoneAchievedFeedItem }) => (
    <div data-testid="milestone-card">{item.milestone_type}</div>
  ),
  ReferenceReceivedCard: () => <div data-testid="reference-received-card" />,
  BrandPostCard: () => <div data-testid="brand-post-card" />,
  BrandProductCard: () => <div data-testid="brand-product-card" />,
  UserPostCard: ({ item }: { item: UserPostFeedItem }) => (
    <div data-testid="user-post-card">{item.content}</div>
  ),
}))

import { HomeFeedItemCard } from '@/components/home/HomeFeedItemCard'

describe('HomeFeedItemCard', () => {
  it('renders MemberJoinedCard for member_joined items', () => {
    const item: MemberJoinedFeedItem = {
      feed_item_id: '1',
      item_type: 'member_joined',
      created_at: '2026-02-09T00:00:00Z',
      profile_id: 'p1',
      full_name: 'Test Player',
      role: 'player',
      avatar_url: null,
      nationality_country_id: null,
      base_location: null,
      position: 'midfielder',
      current_club: null,
    }

    render(<HomeFeedItemCard item={item} />)
    expect(screen.getByTestId('member-joined-card')).toBeInTheDocument()
    expect(screen.getByText('Test Player')).toBeInTheDocument()
  })

  it('renders UserPostCard for user_post items', () => {
    const item: UserPostFeedItem = {
      feed_item_id: '2',
      item_type: 'user_post',
      created_at: '2026-02-09T00:00:00Z',
      post_id: 'post-1',
      author_id: 'a1',
      author_name: 'Author',
      author_avatar: null,
      author_role: 'player',
      content: 'Hello HOCKIA community!',
      images: null,
      like_count: 0,
      comment_count: 0,
      has_liked: false,
    }

    render(<HomeFeedItemCard item={item} />)
    expect(screen.getByTestId('user-post-card')).toBeInTheDocument()
    expect(screen.getByText('Hello HOCKIA community!')).toBeInTheDocument()
  })

  it('renders MilestoneCard for 100% completion', () => {
    const item: MilestoneAchievedFeedItem = {
      feed_item_id: '3',
      item_type: 'milestone_achieved',
      created_at: '2026-02-09T00:00:00Z',
      milestone_type: 'profile_100_percent',
      profile_id: 'p1',
      full_name: 'Player',
      avatar_url: null,
      role: 'player',
    }

    render(<HomeFeedItemCard item={item} />)
    expect(screen.getByTestId('milestone-card')).toBeInTheDocument()
    expect(screen.getByText('profile_100_percent')).toBeInTheDocument()
  })

  it('returns null for unknown item types', () => {
    const item = {
      feed_item_id: '99',
      item_type: 'unknown_type' as never,
      created_at: '2026-02-09T00:00:00Z',
    }

    const { container } = render(<HomeFeedItemCard item={item as unknown as HomeFeedItem} />)
    expect(container.innerHTML).toBe('')
  })
})
