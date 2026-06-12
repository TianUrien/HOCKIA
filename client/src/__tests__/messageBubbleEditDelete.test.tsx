import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ChatMessage, MessageDeliveryStatus } from '@/types/chat'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => <span>{initials}</span>,
}))
vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role: string }) => <span>{role}</span>,
}))

import { MessageBubble } from '@/features/chat-v2/components/MessageBubble'

const baseMessage: ChatMessage = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'me',
  content: 'Original text',
  sent_at: '2026-02-12T10:00:00Z',
  read_at: null,
}

function renderBubble(overrides: Partial<ChatMessage> = {}, props: Record<string, unknown> = {}) {
  const onEditSave = vi.fn().mockResolvedValue(true)
  const onDelete = vi.fn().mockResolvedValue(true)
  render(
    <MessageBubble
      message={{ ...baseMessage, ...overrides }}
      isMine
      status={'delivered' as MessageDeliveryStatus}
      isGroupedWithPrevious={false}
      showDayDivider={false}
      showTimestamp={false}
      isUnreadMarker={false}
      onRetry={vi.fn()}
      onDeleteFailed={vi.fn()}
      onEditSave={onEditSave}
      onDelete={onDelete}
      {...props}
    />,
  )
  return { onEditSave, onDelete }
}

describe('MessageBubble — edit & delete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the options trigger for an own delivered message', () => {
    renderBubble()
    expect(screen.getByTestId('message-options-trigger')).toBeInTheDocument()
  })

  it('does NOT show the options trigger for a received message', () => {
    renderBubble({}, { isMine: false })
    expect(screen.queryByTestId('message-options-trigger')).not.toBeInTheDocument()
  })

  it('does NOT show the options trigger while a message is sending or failed', () => {
    const { rerender } = render(
      <MessageBubble
        message={baseMessage}
        isMine
        status={'sending' as MessageDeliveryStatus}
        isGroupedWithPrevious={false}
        showDayDivider={false}
        showTimestamp={false}
        isUnreadMarker={false}
        onRetry={vi.fn()}
        onDeleteFailed={vi.fn()}
        onEditSave={vi.fn().mockResolvedValue(true)}
        onDelete={vi.fn().mockResolvedValue(true)}
      />,
    )
    expect(screen.queryByTestId('message-options-trigger')).not.toBeInTheDocument()
    void rerender
  })

  it('edits an own message and saves the trimmed content', async () => {
    const user = userEvent.setup()
    const { onEditSave } = renderBubble()

    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-edit-action'))

    const editor = screen.getByLabelText('Edit message')
    await user.clear(editor)
    await user.type(editor, '  Updated text  ')
    await user.click(screen.getByTestId('message-edit-save'))

    await waitFor(() => expect(onEditSave).toHaveBeenCalledWith('msg-1', 'Updated text'))
  })

  it('disables Save when the edited message is empty', async () => {
    const user = userEvent.setup()
    const { onEditSave } = renderBubble()

    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-edit-action'))
    await user.clear(screen.getByLabelText('Edit message'))

    expect(screen.getByTestId('message-edit-save')).toBeDisabled()
    expect(onEditSave).not.toHaveBeenCalled()
  })

  it('cancels edit mode without saving', async () => {
    const user = userEvent.setup()
    const { onEditSave } = renderBubble()

    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-edit-action'))
    await user.clear(screen.getByLabelText('Edit message'))
    await user.type(screen.getByLabelText('Edit message'), 'Changed but cancelled')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Edit message')).not.toBeInTheDocument()
    expect(onEditSave).not.toHaveBeenCalled()
    expect(screen.getByText('Original text')).toBeInTheDocument()
  })

  it('deletes an own message after confirmation', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderBubble()

    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-delete-action'))

    const dialog = screen.getByTestId('message-delete-confirm')
    await user.click(within(dialog).getByText('Delete'))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('msg-1'))
  })

  it('does not delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderBubble()

    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-delete-action'))

    const dialog = screen.getByTestId('message-delete-confirm')
    await user.click(within(dialog).getByText('Cancel'))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('renders a "Message deleted" tombstone and no options for a deleted message', () => {
    renderBubble({ deleted_at: '2026-02-12T11:00:00Z', content: '' })
    expect(screen.getByTestId('message-deleted')).toHaveTextContent('Message deleted')
    expect(screen.queryByTestId('message-options-trigger')).not.toBeInTheDocument()
  })

  it('shows an "edited" label on an edited message', () => {
    renderBubble({ edited_at: '2026-02-12T11:00:00Z' })
    expect(screen.getByText('edited')).toBeInTheDocument()
  })

  it('omits Edit (keeps Delete) for a shared-post message', async () => {
    const user = userEvent.setup()
    renderBubble({
      content: 'Shared a post',
      metadata: {
        type: 'shared_post',
        post_id: 'p1',
        author_id: 'a1',
        author_name: 'Author',
        author_avatar: null,
        author_role: 'coach',
        content_preview: 'preview',
        thumbnail_url: null,
      },
    })
    await user.click(screen.getByTestId('message-options-trigger'))
    expect(screen.queryByTestId('message-edit-action')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-delete-action')).toBeInTheDocument()
  })
})
