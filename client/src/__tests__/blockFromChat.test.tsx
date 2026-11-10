/**
 * Block where the contact happens (founder 2026-11-10): the chat "…" menu, a
 * conversation's press-and-hold menu and the end of a chat report.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}))

const blockMember = vi.fn()
vi.mock('@/lib/blockMember', () => ({ blockMember: (...args: unknown[]) => blockMember(...args) }))

import { BlockMemberSheet } from '@/components/safety/BlockMemberSheet'
import { ConversationActionsSheet } from '@/components/inbox/ConversationActionsSheet'
import { ReportSheet } from '@/components/safety/ReportSheet'

describe('BlockMemberSheet', () => {
  beforeEach(() => { blockMember.mockReset(); rpc.mockReset() })

  it('asks first, then blocks and tells the caller', async () => {
    const user = userEvent.setup()
    blockMember.mockResolvedValue(undefined)
    const onBlocked = vi.fn()
    render(<BlockMemberSheet target={{ id: 'other', name: 'Sam Example' }} onClose={vi.fn()} onBlocked={onBlocked} />)
    expect(screen.getByText('Block Sam Example?')).toBeInTheDocument()
    expect(screen.getByTestId('block-member-confirm')).toHaveTextContent("They aren't told")
    expect(blockMember).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('block-member-confirm-yes'))
    await waitFor(() => expect(blockMember).toHaveBeenCalledWith('me', 'other'))
    expect(onBlocked).toHaveBeenCalledWith({ id: 'other', name: 'Sam Example' })
  })

  it('does not report success when the block fails', async () => {
    const user = userEvent.setup()
    blockMember.mockRejectedValue(new Error('nope'))
    const onBlocked = vi.fn()
    render(<BlockMemberSheet target={{ id: 'other', name: 'Sam Example' }} onClose={vi.fn()} onBlocked={onBlocked} />)
    await user.click(screen.getByTestId('block-member-confirm-yes'))
    await waitFor(() => expect(blockMember).toHaveBeenCalled())
    expect(onBlocked).not.toHaveBeenCalled()
  })
})

describe('ConversationActionsSheet — Block', () => {
  it('offers Block with the name when the other person is known', async () => {
    const user = userEvent.setup()
    const onBlock = vi.fn()
    const target = { id: 'conv-1', name: 'Sam Example', unread: false, otherId: 'other' }
    render(<ConversationActionsSheet target={target} onClose={vi.fn()} onToggleUnread={vi.fn()} onDelete={vi.fn()} onBlock={onBlock} />)
    const item = screen.getByTestId('conversation-block')
    expect(item).toHaveTextContent('Block Sam Example')
    await user.click(item)
    expect(onBlock).toHaveBeenCalledWith(target)
  })

  it('has no Block when the caller does not handle it', () => {
    render(<ConversationActionsSheet target={{ id: 'conv-1', name: 'Sam Example', unread: false, otherId: 'other' }} onClose={vi.fn()} onToggleUnread={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByTestId('conversation-block')).not.toBeInTheDocument()
  })
})

describe('ReportSheet — offer to block after a chat report', () => {
  beforeEach(() => { rpc.mockReset() })

  it('offers to block once the report is sent', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValue({ data: null, error: null })
    const onBlock = vi.fn()
    const onClose = vi.fn()
    render(<ReportSheet open onClose={onClose} targetId="other" subject="chat" contentId="conv-1" offerBlock={{ name: 'Sam', onBlock }} />)
    await user.click(screen.getAllByRole('radio')[0])
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    const offer = await screen.findByTestId('report-block-offer')
    expect(offer).toHaveTextContent('Do you also want to block Sam?')
    expect(onBlock).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('report-block-offer-yes'))
    expect(onBlock).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('just closes after the report when no block is offered', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValue({ data: null, error: null })
    const onClose = vi.fn()
    render(<ReportSheet open onClose={onClose} targetId="other" subject="profile" />)
    await user.click(screen.getAllByRole('radio')[0])
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByTestId('report-block-offer')).not.toBeInTheDocument()
  })
})
