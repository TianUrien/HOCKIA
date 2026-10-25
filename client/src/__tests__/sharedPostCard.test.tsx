import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

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

import { SharedPostCard } from '@/features/chat-v2/components/SharedPostCard'

const user = userEvent.setup()

const defaultProps = {
  postId: 'post-123',
  authorName: 'Test Author',
  authorAvatar: 'https://example.com/avatar.jpg',
  authorRole: 'player' as const,
  contentPreview: 'This is a shared post preview...',
  thumbnailUrl: null as string | null,
  isMine: false,
}

describe('SharedPostCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders author name and content preview', () => {
    render(<SharedPostCard {...defaultProps} />)

    expect(screen.getByText('Test Author')).toBeInTheDocument()
    expect(screen.getByText('This is a shared post preview...')).toBeInTheDocument()
    expect(screen.getByText('View post')).toBeInTheDocument()
  })

  it('renders role badge', () => {
    render(<SharedPostCard {...defaultProps} />)

    expect(screen.getByTestId('role-badge')).toHaveTextContent('player')
  })

  it('renders "Unknown" when author name is null', () => {
    render(<SharedPostCard {...defaultProps} authorName={null} />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders thumbnail when provided', () => {
    const { container } = render(
      <SharedPostCard
        {...defaultProps}
        thumbnailUrl="https://example.com/thumb.jpg"
      />,
    )

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg')
  })

  it('does not render thumbnail when null', () => {
    const { container } = render(<SharedPostCard {...defaultProps} thumbnailUrl={null} />)

    expect(container.querySelector('img')).toBeNull()
  })

  it('navigates to post on click', async () => {
    render(<SharedPostCard {...defaultProps} />)

    await user.click(screen.getByRole('button'))

    expect(navigateMock).toHaveBeenCalledWith('/post/post-123')
  })

  it('applies sender styling when isMine is true', () => {
    render(<SharedPostCard {...defaultProps} isMine={true} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('bg-white/10')
  })

  it('applies receiver styling when isMine is false', () => {
    render(<SharedPostCard {...defaultProps} isMine={false} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('border-line')
    expect(button.className).toContain('bg-surface-subtle')
  })
})
