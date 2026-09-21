import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const user = userEvent.setup()

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 'user-1' } as { id: string } | null,
    profile: {
      full_name: 'Test Player',
      avatar_url: null,
      role: 'player',
    } as { full_name: string | null; avatar_url: string | null; role: string } | null,
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState.value,
}))

vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <span data-testid="avatar">{initials}</span>,
}))

vi.mock('@/components/home/PostComposerModal', () => ({
  PostComposerModal: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="composer-modal">Modal Open</div> : null
  ),
}))

import { PostComposer } from '@/components/home/PostComposer'

const onPostCreated = vi.fn()

describe('PostComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.value = {
      user: { id: 'user-1' },
      profile: { full_name: 'Test Player', avatar_url: null, role: 'player' },
    }
  })

  it('renders the "What\'s new?" trigger when authenticated', () => {
    render(<PostComposer onPostCreated={onPostCreated} />)

    expect(screen.getByText("What's new?")).toBeInTheDocument()
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a photo or video')).toBeInTheDocument()
  })

  it('returns null when user is not authenticated', () => {
    authState.value = { user: null, profile: null }

    const { container } = render(<PostComposer onPostCreated={onPostCreated} />)
    expect(container.innerHTML).toBe('')
  })

  it('opens modal when the prompt is clicked', async () => {
    render(<PostComposer onPostCreated={onPostCreated} />)

    // Modal should not be open initially
    expect(screen.queryByTestId('composer-modal')).not.toBeInTheDocument()

    // Click trigger
    await user.click(screen.getByText("What's new?"))

    // Modal should open
    expect(screen.getByTestId('composer-modal')).toBeInTheDocument()
  })

  it('opens modal when image button is clicked', async () => {
    render(<PostComposer onPostCreated={onPostCreated} />)

    await user.click(screen.getByLabelText('Add a photo or video'))

    expect(screen.getByTestId('composer-modal')).toBeInTheDocument()
  })
})
