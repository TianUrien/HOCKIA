/**
 * Home feed, facts only (founder 2026-11-10): the weekly "open to play" card
 * and click tracking for links inside feed cards.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const trackDbEvent = vi.fn()
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...args: unknown[]) => trackDbEvent(...args) }))
vi.mock('@/lib/supabase', () => ({ supabase: {}, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

const openDeckByIds = vi.fn()
vi.mock('@/components/home/v1/homeV1Context', () => ({ useHomeV1: () => ({ openDeckByIds }) }))

import { linkDestination, trackCardLinkClick } from '@/lib/homeInstrumentation'
import { OpenToPlayWeekCard } from '@/components/home/v1/cards/DigestCard'
import type { OpenToPlayWeekFeedItem } from '@/types/homeFeed'

describe('linkDestination', () => {
  it('keeps the section and never a name or an id', () => {
    expect(linkDestination('/players/ana-perez')).toBe('/players/:id')
    expect(linkDestination('/players/id/3f2b9c1e-0000-4000-8000-000000000000')).toBe('/players/:id')
    expect(linkDestination('/post/3f2b9c1e-0000-4000-8000-000000000000?x=1')).toBe('/post/:id')
    expect(linkDestination('/opportunities')).toBe('/opportunities')
    expect(linkDestination('/inbox#top')).toBe('/inbox')
  })

  it('ignores links that leave the app', () => {
    expect(linkDestination('https://example.org/x')).toBeNull()
    expect(linkDestination('//example.org')).toBeNull()
    expect(linkDestination(null)).toBeNull()
  })
})

describe('trackCardLinkClick', () => {
  beforeEach(() => trackDbEvent.mockReset())

  it('records a Home card click with the destination', () => {
    trackCardLinkClick('item-1', 'user_post', '/players/ana-perez')
    expect(trackDbEvent).toHaveBeenCalledWith('home_card_click', 'feed_item', 'item-1', expect.objectContaining({ item_type: 'user_post', destination: '/players/:id' }))
  })

  it('records nothing when the tap was not on an in-app link', () => {
    trackCardLinkClick('item-1', 'user_post', undefined)
    trackCardLinkClick('item-1', 'user_post', 'https://youtu.be/x')
    expect(trackDbEvent).not.toHaveBeenCalled()
  })
})

describe('OpenToPlayWeekCard', () => {
  const member = (i: number) => ({ id: `p${i}`, full_name: `Player ${i}`, avatar_url: null, role: 'player', position: 'defender' })
  const item: OpenToPlayWeekFeedItem = {
    feed_item_id: 'week-1',
    item_type: 'open_to_play_week',
    created_at: '2026-11-09T10:00:00Z',
    week_start: '2026-11-09',
    member_count: 8,
    members: Array.from({ length: 8 }, (_, i) => member(i + 1)),
  }

  beforeEach(() => { trackDbEvent.mockReset(); openDeckByIds.mockReset() })

  it('says how many players are open to play and shows six tiles with +N', () => {
    render(<OpenToPlayWeekCard item={item} />)
    expect(screen.getByText('8 players are open to play')).toBeInTheDocument()
    expect(screen.getByTestId('home-open-to-play-card').querySelectorAll('button[aria-label]').length).toBe(6)
    expect(screen.getByLabelText('3 more players open to play')).toBeInTheDocument()
    expect(screen.getByLabelText('Player 1, open to play')).toBeInTheDocument()
  })

  it('opens the deck with every player of the week and reports the click', async () => {
    const user = userEvent.setup()
    render(<OpenToPlayWeekCard item={item} />)
    await user.click(screen.getByLabelText('Player 2, open to play'))
    expect(openDeckByIds).toHaveBeenCalledWith(item.members.map((m) => m.id), 1, '8 players are open to play')
    expect(trackDbEvent).toHaveBeenCalledWith('home_card_click', 'feed_item', 'week-1', expect.objectContaining({ item_type: 'open_to_play_week', destination: 'member_deck' }))
  })
})
