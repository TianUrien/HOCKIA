/**
 * Home as a feed of posts (founder 2026-11-24): the post entry at the top,
 * the feed asked for member posts only, an honest end that offers to post and
 * the same block when there is no post at all.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const rpc = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ profile: { id: 'me', role: 'player', avatar_url: null as string | null } }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (select?: (s: typeof auth) => unknown) => (typeof select === 'function' ? select(auth) : auth) }))
vi.mock('@/lib/homeInstrumentation', () => ({
  HOME_V1_MODULES: { endOfFeed: { id: 'v1_end_of_feed', position: 5 } },
  recordModuleImpression: vi.fn(),
  useImpressionOnce: () => ({ current: null }),
}))
vi.mock('@/components/Avatar', () => ({ default: () => <span data-testid="avatar" /> }))

import { PostEntry } from '@/components/home/v1/PostEntry'
import { EndOfFeed } from '@/components/home/v1/EndOfFeed'
import { useHomeFeed } from '@/hooks/useHomeFeed'

describe('PostEntry', () => {
  beforeEach(() => { auth.profile.role = 'player' })

  it('opens the composer from a field-shaped button', async () => {
    const onCompose = vi.fn()
    render(<PostEntry onCompose={onCompose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Share something from your hockey' }))
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('speaks to a club as a club', () => {
    auth.profile.role = 'club'
    render(<PostEntry onCompose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Share news from your club' })).toBeInTheDocument()
  })
})

describe('EndOfFeed', () => {
  it('says the feed is done and offers to post, with no filler rows', async () => {
    const onCompose = vi.fn()
    render(<EndOfFeed onCompose={onCompose} />)
    const end = screen.getByTestId('home-end-of-feed')
    expect(end.textContent).toContain('You’re up to date')
    expect(end.querySelectorAll('section, [data-testid="home-roles-rail"]').length).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('is the empty feed when there is no post at all', () => {
    render(<EndOfFeed empty onCompose={vi.fn()} />)
    expect(screen.getByTestId('home-empty-feed').textContent).toContain('No posts yet this week')
    expect(screen.queryByTestId('home-end-of-feed')).toBeNull()
  })
})

describe('useHomeFeed, posts only', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  )
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { items: [], total: 0 }, error: null }) })

  it('asks the server for member posts only', async () => {
    renderHook(() => useHomeFeed({ v2: true, postsOnly: true }), { wrapper })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('get_home_feed_v2', expect.objectContaining({ p_posts_only: true, p_open_to_play: true }))
  })

  it('does not send the argument for the previous feed', async () => {
    renderHook(() => useHomeFeed({ v2: true }), { wrapper })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_posts_only')
  })
})
