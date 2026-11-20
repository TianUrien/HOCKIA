/**
 * Where the Home separates two facts with a gap instead of a dot, the text
 * itself still carries a real space between them, so a screen reader and an
 * accessible name never run them together ("Highlight2h").
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
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
vi.mock('@/hooks/useFeedAuthorContext', () => ({
  useAuthorContext: () => ({ club: 'Old Lions', city: 'Rosario' }),
}))

import { FeedCardHeader } from '@/components/home/FeedCard'
import { PostHeader } from '@/components/home/v1/PostParts'
import { SectionHeader } from '@/components/home/pulse/SectionHeader'
import { CommentListItem } from '@/components/ui/CommentListItem'

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('Home: facts split into sibling elements keep a real space', () => {
  it('feed card header: name, then "Player, Old Lions", then the time', () => {
    const { container } = render(
      <MemoryRouter>
        <FeedCardHeader authorId="a1" name="Ana Ruiz" avatarUrl="https://h.test/a.jpg" role="player" createdAt={new Date(Date.now() - 2 * 3600_000).toISOString()} profilePath={null} />
      </MemoryRouter>,
    )
    const line = container.querySelector('time')?.parentElement
    expect(line?.textContent).toMatch(/^Player, Old Lions \S/)
    expect(line?.textContent).not.toMatch(/Lions\S/)
  })

  it('v1 post header: name, subtitle and age are three words apart', () => {
    const { container } = render(
      <MemoryRouter>
        <PostHeader authorId="a1" name="Ana Ruiz" avatarUrl="https://h.test/a.jpg" role="player" subtitle="Highlight" age="2h" profilePath={null} />
      </MemoryRouter>,
    )
    expect(container.textContent).toContain('Ana Ruiz Highlight 2h')
  })

  it('comment: name, role and time', () => {
    render(<ul><CommentListItem name="Ana" avatarUrl="https://h.test/a.jpg" role="player" meta={<>Player{' '}<time>2h</time></>} text="Great goal" /></ul>)
    expect(screen.getByTestId('comment-meta').textContent).toBe('Player 2h')
    expect(screen.getByTestId('comment-meta').parentElement?.textContent).toBe('Ana Player 2h')
  })

  it('Pulse section header: title, then the chip', () => {
    const { container } = render(<SectionHeader title="Your applications" chip={{ label: '3 active', tone: 'new' }} />)
    expect(text(container)).toContain('Your applications 3 active')
  })
})
