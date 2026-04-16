import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { ChatMessage, MessageDeliveryStatus } from '@/types/chat'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => (
    <span data-testid="avatar">{initials}</span>
  ),
}))

vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role: string }) => (
    <span data-testid="role-badge">{role}</span>
  ),
}))

import { MessageBubble } from '@/features/chat-v2/components/MessageBubble'

const baseMessage: ChatMessage = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'user-1',
  content: 'Hello world',
  sent_at: '2026-02-12T10:00:00Z',
  read_at: null,
}

const defaultProps = {
  isMine: false,
  status: 'sent' as MessageDeliveryStatus,
  isGroupedWithPrevious: false,
  showDayDivider: false,
  showTimestamp: false,
  isUnreadMarker: false,
  onRetry: vi.fn(),
  onDeleteFailed: vi.fn(),
}

describe('MessageBubble — shared post rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders plain text for messages without metadata', () => {
    render(
      <MessageBubble
        message={baseMessage}
        {...defaultProps}
      />,
    )

    expect(screen.getByText('Hello world')).toBeInTheDocument()
    // Should NOT render SharedPostCard elements
    expect(screen.queryByText('View post')).not.toBeInTheDocument()
  })

  it('renders SharedPostCard for messages with shared_post metadata', () => {
    const sharedPostMessage: ChatMessage = {
      ...baseMessage,
      content: 'Shared a post',
      metadata: {
        type: 'shared_post',
        post_id: 'post-456',
        author_id: 'author-1',
        author_name: 'Post Author',
        author_avatar: null,
        author_role: 'coach',
        content_preview: 'Amazing training session today...',
        thumbnail_url: null,
      },
    }

    render(
      <MessageBubble
        message={sharedPostMessage}
        {...defaultProps}
      />,
    )

    // Should render SharedPostCard content
    expect(screen.getByText('Post Author')).toBeInTheDocument()
    expect(screen.getByText('Amazing training session today...')).toBeInTheDocument()
    expect(screen.getByText('View post')).toBeInTheDocument()

    // Should NOT render the raw content text
    expect(screen.queryByText('Shared a post')).not.toBeInTheDocument()
  })

  it('renders SharedPostCard with thumbnail when provided', () => {
    const sharedPostMessage: ChatMessage = {
      ...baseMessage,
      content: 'Shared a post',
      metadata: {
        type: 'shared_post',
        post_id: 'post-789',
        author_id: 'author-2',
        author_name: 'Club Name',
        author_avatar: 'https://example.com/club.jpg',
        author_role: 'club',
        content_preview: 'We are thrilled to announce...',
        thumbnail_url: 'https://example.com/thumb.jpg',
      },
    }

    const { container } = render(
      <MessageBubble
        message={sharedPostMessage}
        {...defaultProps}
      />,
    )

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg')
  })

  it('passes isMine correctly to SharedPostCard', () => {
    const sharedPostMessage: ChatMessage = {
      ...baseMessage,
      content: 'Shared a post',
      metadata: {
        type: 'shared_post',
        post_id: 'post-456',
        author_id: 'author-1',
        author_name: 'Sender',
        author_avatar: null,
        author_role: 'player',
        content_preview: 'My post content',
        thumbnail_url: null,
      },
    }

    // Render as "mine" — the SharedPostCard should get sender styling
    const { container } = render(
      <MessageBubble
        message={sharedPostMessage}
        {...defaultProps}
        isMine={true}
      />,
    )

    // The outer bubble has purple gradient when isMine
    const bubble = container.querySelector('.from-purple-500')
    expect(bubble).not.toBeNull()

    // The card inside should have sender styling
    const card = screen.getByRole('button')
    expect(card.className).toContain('bg-white/10')
  })
})
