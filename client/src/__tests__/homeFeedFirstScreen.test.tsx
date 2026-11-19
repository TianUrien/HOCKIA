import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

const feed = vi.hoisted(() => ({
  value: { items: [] as Array<Record<string, unknown>>, isLoading: false, error: null as string | null },
}))

vi.mock('@/hooks/useHomeFeed', () => ({
  useHomeFeed: () => ({
    ...feed.value, isFetchingNextPage: false, refetch: vi.fn(), hasMore: false, loadMore: vi.fn(),
    updateItemLike: vi.fn(), removeItem: vi.fn(), prependItem: vi.fn(), patchItem: vi.fn(), newCount: 0, showNewItems: vi.fn(),
  }),
}))
vi.mock('@/hooks/useMemberAges', () => ({ useMemberAges: () => new Map() }))
vi.mock('@/hooks/useFeedAuthorContext', async () => {
  const { createContext } = await import('react')
  return { FeedAuthorContext: createContext(() => null), useFeedAuthorContext: () => () => null }
})
vi.mock('@/lib/auth', () => ({ useAuthStore: (select: (s: { profile: { role: string } }) => unknown) => select({ profile: { role: 'club' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (select: (s: { addToast: () => void }) => unknown) => select({ addToast: vi.fn() }) }))
vi.mock('@/lib/homeInstrumentation', () => ({
  HOME_V1_MODULES: { feed: { id: 'v1_feed', position: 2 }, rolesRail: { id: 'v1_roles_rail', position: 3 } },
  recordCardImpression: vi.fn(), recordModuleImpression: vi.fn(), recordPostImpression: vi.fn(),
  scrollMilestonesCrossed: () => [], trackCardLinkClick: vi.fn(), trackFeedScroll: vi.fn(),
  useImpressionOnce: () => ({ current: null }),
}))
vi.mock('@/components/home/cards', () => ({ UserPostCard: ({ item }: { item: { feed_item_id: string } }) => <article data-testid={`post-${item.feed_item_id}`} /> }))
vi.mock('@/components/home/HomeFeedItemCard', () => ({ HomeFeedItemCard: () => null }))
vi.mock('@/components/home/v1/cards/SigningCard', () => ({ SigningCard: () => null }))
vi.mock('@/components/home/v1/cards/VideoCards', () => ({ VideoCard: () => null }))
vi.mock('@/components/home/v1/cards/PhotosCard', () => ({ PhotosCard: () => null }))
vi.mock('@/components/home/v1/cards/ReferenceCard', () => ({ ReferenceCard: () => null }))
vi.mock('@/components/home/v1/cards/OpportunityCard', () => ({ OpportunityCard: () => null }))
vi.mock('@/components/home/v1/cards/DigestCard', () => ({ DigestCard: () => null, OpenToPlayWeekCard: () => null }))
vi.mock('@/components/home/v1/RolesRail', () => ({ RolesRail: () => null }))
vi.mock('@/components/home/v1/EndOfFeed', () => ({ EndOfFeed: () => <div data-testid="end-of-feed" /> }))
vi.mock('@/components/home/v1/CommentsSheet', () => ({ CommentsSheet: () => null }))
vi.mock('@/components/home/v1/useHomePeople', () => ({ fetchProfilesByIds: vi.fn() }))

import { HomeV1Feed } from '@/components/home/v1/HomeV1Feed'

const post = (id: string) => ({ feed_item_id: id, item_type: 'user_post', post_id: id, post_type: 'text' })
const order = (...ids: string[]) => {
  const nodes = ids.map((id) => screen.getByTestId(id))
  return nodes.every((n, i) => i === 0 || Boolean(nodes[i - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))
}
const renderFeed = (afterFirst: React.ReactNode = <div data-testid="goal" />) =>
  render(<HomeV1Feed header={<div data-testid="next-step" />} afterFirst={afterFirst} />)

describe('Home: a post on the first screen', () => {
  beforeEach(() => { feed.value = { items: [], isLoading: false, error: null } })

  it('puts the first feed item right after the header, and goal, gear and people after it', () => {
    feed.value.items = [post('a'), post('b')]
    renderFeed()
    expect(order('next-step', 'post-a', 'goal', 'post-b')).toBe(true)
    expect(screen.getAllByTestId('goal')).toHaveLength(1)
  })

  it('keeps those blocks under the header when the feed is empty', () => {
    renderFeed()
    expect(order('next-step', 'goal', 'end-of-feed')).toBe(true)
  })

  it('keeps them when the feed fails to load', () => {
    feed.value.error = 'offline'
    renderFeed()
    expect(order('next-step', 'goal', 'home-feed-error')).toBe(true)
  })

  it('holds them back while the first page loads, so nothing jumps under the reader', () => {
    feed.value.isLoading = true
    renderFeed()
    expect(screen.queryByTestId('goal')).toBeNull()
  })

  it('leaves an empty wrapper, which CSS hides, when every block renders nothing', () => {
    feed.value.items = [post('a')]
    renderFeed(<>{null}</>)
    const wrapper = screen.getByTestId('home-after-first')
    expect(wrapper.childNodes).toHaveLength(0)
    expect(wrapper.className).toContain('empty:hidden')
  })
})
