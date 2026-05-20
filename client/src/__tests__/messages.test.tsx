import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ConversationList from '@/components/ConversationList'
import ChatWindowV2 from '@/features/chat-v2/ChatWindowV2'
import { vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    })
  }
}))

const mockUseChat = vi.fn()
const mockUseMediaQuery = vi.fn(() => false)
const mockUseSafeArea = vi.fn()
const scrollToBottom = vi.fn()
const getDistanceFromBottom = vi.fn(() => 0)
const mockScrollController = {
  scrollContainerRef: { current: document.createElement('div') as HTMLDivElement },
  isAutoScrollingRef: { current: false },
  isViewerAtBottom: () => true,
  scrollToBottom,
  getDistanceFromBottom
}

vi.mock('@/hooks/useChat', () => ({
  useChat: (options: unknown) => mockUseChat(options)
}))

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockUseMediaQuery()
}))

vi.mock('@/hooks/useSafeArea', () => ({
  useSafeArea: () => mockUseSafeArea()
}))

vi.mock('@/hooks/useChatScrollController', () => ({
  useChatScrollController: () => mockScrollController
}))

type ConversationListConversation = Parameters<typeof ConversationList>[0]['conversations'][number]
type ChatConversation = Parameters<typeof ChatWindowV2>[0]['conversation']

const listConversationBase: ConversationListConversation = {
  id: 'conv-1',
  participant_one_id: 'user-1',
  participant_two_id: 'user-2',
  created_at: new Date('2024-01-01').toISOString(),
  updated_at: new Date('2024-01-01').toISOString(),
  last_message_at: new Date('2024-01-01').toISOString(),
  otherParticipant: {
    id: 'user-2',
    full_name: 'Alex Morgan',
    username: 'alex',
    avatar_url: null,
    role: 'player'
  },
  lastMessage: {
    content: 'Ready for training?',
    sent_at: new Date('2024-01-01').toISOString(),
    sender_id: 'user-2'
  },
  unreadCount: 1
}

const user = userEvent.setup()

const resolvedChatState = {
  messages: [
    {
      id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'user-2',
      content: 'Welcome back',
      sent_at: new Date('2024-01-01').toISOString(),
      read_at: null,
      created_at: new Date('2024-01-01').toISOString(),
      updated_at: new Date('2024-01-01').toISOString()
    },
    {
      id: 'msg-2',
      conversation_id: 'conv-1',
      sender_id: 'viewer-1',
      content: 'See you soon',
      sent_at: new Date('2024-01-02').toISOString(),
      read_at: null,
      created_at: new Date('2024-01-02').toISOString(),
      updated_at: new Date('2024-01-02').toISOString()
    }
  ],
  loading: false,
  sending: false,
  newMessage: '',
  setNewMessage: vi.fn(),
  hasMoreMessages: false,
  isLoadingMore: false,
  sendMessage: vi.fn(),
  loadOlderMessages: vi.fn(),
  queueReadReceipt: vi.fn(),
  markConversationAsRead: vi.fn(),
  retryMessage: vi.fn(),
  deleteFailedMessage: vi.fn()
}

beforeEach(() => {
  mockUseChat.mockReturnValue(resolvedChatState)
  mockUseMediaQuery.mockReturnValue(false)
  scrollToBottom.mockClear()
  const container = document.createElement('div')
  document.body.appendChild(container)
  mockScrollController.scrollContainerRef.current = container
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const chatConversationBase: ChatConversation = {
  id: 'chat-1',
  participant_one_id: 'viewer-1',
  participant_two_id: 'user-2',
  created_at: new Date('2024-02-01').toISOString(),
  updated_at: new Date('2024-02-01').toISOString(),
  last_message_at: new Date('2024-02-01').toISOString(),
  otherParticipant: {
    id: 'user-2',
    full_name: 'Alex Morgan',
    username: 'alex',
    avatar_url: null,
    role: 'player'
  }
}

function renderChatWindow(overrides?: Partial<ChatConversation>) {
  const conversation = { ...chatConversationBase, ...overrides }
  return render(
    <MemoryRouter>
      <ChatWindowV2
        conversation={conversation}
        currentUserId="viewer-1"
        onBack={vi.fn()}
        onConversationCreated={vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('Messages flows', () => {
  it('keeps the conversation list visible when navigating back from a chat', async () => {
    const conversations = [
      listConversationBase,
      {
        ...listConversationBase,
        id: 'conv-2',
        otherParticipant: {
          ...listConversationBase.otherParticipant!,
          id: 'user-3',
          full_name: 'Jordan Pickford',
          username: 'jordan'
        },
        lastMessage: {
          content: 'Training complete',
          sent_at: new Date('2024-01-03').toISOString(),
          sender_id: 'user-3'
        }
      }
    ]

    const handleSelect = vi.fn()
    const { rerender } = render(
      <ConversationList
        conversations={conversations}
        selectedConversationId="conv-2"
        onSelectConversation={handleSelect}
        currentUserId="viewer-1"
      />
    )

    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    expect(screen.getByText('Jordan Pickford')).toBeInTheDocument()

    await user.click(screen.getByText('Alex Morgan'))
    expect(handleSelect).toHaveBeenCalledWith('conv-1')

    rerender(
      <ConversationList
        conversations={conversations}
        selectedConversationId={null}
        onSelectConversation={handleSelect}
        currentUserId="viewer-1"
      />
    )

    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    expect(screen.getByText('Jordan Pickford')).toBeInTheDocument()
  })

  it('scrolls to the latest message when a chat opens', async () => {
    renderChatWindow()

    await waitFor(() => {
      expect(scrollToBottom).toHaveBeenCalled()
    })

    scrollToBottom.mockClear()

    renderChatWindow({ id: 'conv-9' })
    await waitFor(() => {
      expect(scrollToBottom).toHaveBeenCalled()
    })
  })

  it('keeps only the message list scrollable on mobile', async () => {
    mockUseMediaQuery.mockReturnValue(true)
    const { getByLabelText } = renderChatWindow()

    const backButton = getByLabelText('Back to conversations')
    const header = backButton.closest('header')
    expect(header).not.toBeNull()
    // Header should be relative on mobile without immersive mode
    expect(header).toHaveClass('relative')

    const messageList = screen.getByTestId('chat-message-list')
    expect(messageList).toHaveClass('chat-scroll-container')
  })

  it('anchors the window with a viewport-sized fixed overlay on mobile immersive, keeping header and composer in flex flow', () => {
    // Desktop: window, header and composer all in normal relative flow.
    mockUseMediaQuery.mockReturnValue(false)
    const { container: desktopContainer, rerender } = renderChatWindow()

    let header = screen.getByRole('banner')
    expect(header).toHaveClass('relative')
    expect(header).not.toHaveClass('fixed')

    let composer = desktopContainer.querySelector('form')
    expect(composer).not.toBeNull()
    expect(composer).toHaveClass('relative')
    expect(composer).not.toHaveClass('fixed')

    // Mobile immersive: only the window container is fixed (sized to the
    // visual viewport). Header and composer stay relative flex children
    // so the keyboard simply shrinks the container.
    mockUseMediaQuery.mockReturnValue(true)
    rerender(
      <MemoryRouter>
        <ChatWindowV2
          conversation={{ ...chatConversationBase }}
          currentUserId="viewer-1"
          onBack={vi.fn()}
          onConversationCreated={vi.fn()}
          isImmersiveMobile={true}
        />
      </MemoryRouter>
    )

    header = screen.getByRole('banner')
    const windowRoot = header.parentElement
    expect(windowRoot).not.toBeNull()
    expect(windowRoot).toHaveClass('fixed')

    expect(header).toHaveClass('relative')
    expect(header).not.toHaveClass('fixed')

    composer = desktopContainer.querySelector('form')
    expect(composer).not.toBeNull()
    expect(composer).toHaveClass('relative')
    expect(composer).not.toHaveClass('fixed')
  })

  it('only auto-scrolls when near bottom for new incoming messages', async () => {
    getDistanceFromBottom.mockReturnValue(50) // Near bottom
    renderChatWindow()

    await waitFor(() => {
      expect(scrollToBottom).toHaveBeenCalled()
    })

    scrollToBottom.mockClear()

    // Simulate user scrolled up to read old messages
    getDistanceFromBottom.mockReturnValue(500)

    // Simulate new message arriving
    const newMessages = [
      ...resolvedChatState.messages,
      {
        id: 'msg-3',
        conversation_id: 'conv-1',
        sender_id: 'user-2',
        content: 'New message while scrolled up',
        sent_at: new Date('2024-01-03').toISOString(),
        read_at: null,
        created_at: new Date('2024-01-03').toISOString(),
        updated_at: new Date('2024-01-03').toISOString()
      }
    ]

    mockUseChat.mockReturnValue({
      ...resolvedChatState,
      messages: newMessages
    })

    // Should NOT auto-scroll since user is reading old messages
    expect(scrollToBottom).not.toHaveBeenCalled()
  })

  it('prevents zoom on mobile textarea', () => {
    mockUseMediaQuery.mockReturnValue(true)
    renderChatWindow()

    const textarea = screen.getByPlaceholderText('Type a message...')
    expect(textarea).toHaveClass('chat-textarea')
  })
})
