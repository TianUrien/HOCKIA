/**
 * Messaging actions (founder 2026-11-10): "Delete for me" on any message,
 * the delete chooser for own messages, the press-and-hold menu, and the
 * conversation row's swipe actions + menu.
 */
import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ChatMessage, MessageDeliveryStatus } from '@/types/chat'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

import { MessageBubble } from '@/features/chat-v2/components/MessageBubble'
import { ConversationRow } from '@/components/inbox/ConversationRow'
import { ConversationActionsSheet } from '@/components/inbox/ConversationActionsSheet'

const message: ChatMessage = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'other',
  content: 'Hello from the club',
  sent_at: '2026-02-12T10:00:00Z',
  read_at: null,
}

function renderBubble({ isMine = false, onHideForMe = vi.fn().mockResolvedValue(true), overrides = {} as Partial<ChatMessage> } = {}) {
  const onDelete = vi.fn().mockResolvedValue(true)
  render(
    <MessageBubble
      message={{ ...message, ...(isMine ? { sender_id: 'me' } : {}), ...overrides }}
      isMine={isMine}
      status={'delivered' as MessageDeliveryStatus}
      isGroupedWithPrevious={false}
      showDayDivider={false}
      showTimestamp={false}
      isUnreadMarker={false}
      onRetry={vi.fn()}
      onDeleteFailed={vi.fn()}
      onEditSave={vi.fn().mockResolvedValue(true)}
      onDelete={onDelete}
      onHideForMe={onHideForMe}
    />,
  )
  return { onDelete, onHideForMe }
}

describe('MessageBubble — delete for me', () => {
  it('lets the reader delete a received message for themselves only', async () => {
    const user = userEvent.setup()
    const { onHideForMe, onDelete } = renderBubble()
    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-delete-action'))
    const sheet = screen.getByTestId('message-delete-confirm')
    expect(within(sheet).queryByTestId('message-delete-everyone')).not.toBeInTheDocument()
    await user.click(within(sheet).getByTestId('message-delete-me'))
    await waitFor(() => expect(onHideForMe).toHaveBeenCalledWith('msg-1'))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('offers both choices on an own message', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderBubble({ isMine: true })
    await user.click(screen.getByTestId('message-options-trigger'))
    await user.click(screen.getByTestId('message-delete-action'))
    const sheet = screen.getByTestId('message-delete-confirm')
    expect(within(sheet).getByText('Delete for me')).toBeInTheDocument()
    await user.click(within(sheet).getByText('Delete for everyone'))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('msg-1'))
  })

  it('lets a "Message deleted" tombstone be cleared for me', async () => {
    const user = userEvent.setup()
    const { onHideForMe } = renderBubble({ overrides: { deleted_at: '2026-02-12T11:00:00Z', content: '' } })
    fireEvent.contextMenu(screen.getByTestId('message-deleted'))
    await user.click(screen.getByTestId('message-sheet-delete-action'))
    await user.click(screen.getByTestId('message-delete-me'))
    await waitFor(() => expect(onHideForMe).toHaveBeenCalledWith('msg-1'))
  })

  it('opens the menu on right-click with Copy, and no Edit for a received message', () => {
    renderBubble()
    fireEvent.contextMenu(screen.getByTestId('message-bubble'))
    const sheet = screen.getByTestId('message-actions')
    expect(within(sheet).getByTestId('message-copy-action')).toBeInTheDocument()
    expect(within(sheet).queryByTestId('message-sheet-edit-action')).not.toBeInTheDocument()
    expect(within(sheet).getByTestId('message-sheet-delete-action')).toBeInTheDocument()
  })
})

describe('ConversationRow — actions', () => {
  const base = {
    name: 'Club Atlético',
    avatarUrl: null,
    role: 'club' as const,
    at: '2026-02-12T10:00:00Z',
    contextLine: 'Club',
    preview: 'See you Saturday',
    unread: false,
  }

  it('reveals Unread and Delete behind the row and runs them', () => {
    const onToggleUnread = vi.fn()
    const onDelete = vi.fn()
    render(<ConversationRow {...base} onSelect={vi.fn()} onToggleUnread={onToggleUnread} onDelete={onDelete} onLongPress={vi.fn()} />)
    fireEvent.click(screen.getByTestId('conversation-swipe-unread'))
    expect(onToggleUnread).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('conversation-swipe-delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('opens the menu on right-click without opening the conversation', () => {
    const onSelect = vi.fn()
    const onLongPress = vi.fn()
    render(<ConversationRow {...base} onSelect={onSelect} onToggleUnread={vi.fn()} onDelete={vi.fn()} onLongPress={onLongPress} />)
    const row = screen.getByTestId('conversation-row')
    fireEvent.contextMenu(row)
    fireEvent.click(row)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('stays a plain row when no actions are passed', () => {
    render(<ConversationRow {...base} onSelect={vi.fn()} />)
    expect(screen.queryByTestId('conversation-row-swipe')).not.toBeInTheDocument()
  })
})

describe('ConversationActionsSheet', () => {
  it('marks unread, and deletes only after the confirmation', async () => {
    const user = userEvent.setup()
    const onToggleUnread = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    const target = { id: 'conv-1', name: 'Ana Pérez', unread: false }
    const { rerender } = render(<ConversationActionsSheet target={target} onClose={onClose} onToggleUnread={onToggleUnread} onDelete={onDelete} />)
    await user.click(screen.getByTestId('conversation-mark-unread'))
    expect(onToggleUnread).toHaveBeenCalledWith('conv-1', true)

    rerender(<ConversationActionsSheet target={target} onClose={onClose} onToggleUnread={onToggleUnread} onDelete={onDelete} />)
    await user.click(screen.getByTestId('conversation-delete'))
    expect(onDelete).not.toHaveBeenCalled()
    const confirm = screen.getByTestId('conversation-delete-confirm')
    expect(confirm).toHaveTextContent('Ana still has the conversation')
    await act(async () => { await user.click(screen.getByTestId('conversation-delete-confirm-yes')) })
    expect(onDelete).toHaveBeenCalledWith('conv-1')
  })
})
