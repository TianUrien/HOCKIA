import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The neutral note at the top of a thread with an account Hockia removed.

let rpcResult: { data: unknown; error: unknown } = { data: false, error: null }
const rpcCalls: Array<{ fn: string; args: unknown }> = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
  },
}))

vi.mock('@/components/safety/ReportSheet', () => ({
  ReportSheet: (p: { open: boolean; targetId: string; subject: string; contentId?: string | null }) =>
    p.open ? <div data-testid="report-sheet">{`${p.subject}:${p.targetId}:${p.contentId}`}</div> : null,
}))

import { RemovedAccountNotice } from '@/features/chat-v2/components/RemovedAccountNotice'
import { REMOVED_ACCOUNT_NOTICE, resetRemovedAccountCache } from '@/features/chat-v2/removedAccount'

beforeEach(() => {
  rpcCalls.length = 0
  rpcResult = { data: false, error: null }
  resetRemovedAccountCache()
})

describe('RemovedAccountNotice', () => {
  it('uses the approved text word for word', () => {
    expect(REMOVED_ACCOUNT_NOTICE).toBe(
      "An account that messaged you has been removed for spam. Hockia will never ask you for money. Don't send money, crypto or personal details to people you haven't met, and be careful if someone asks to move to WhatsApp or another app. If something feels off, tap Report.",
    )
  })

  it('shows the note on a grey surface, with Report opening the chat report sheet', async () => {
    rpcResult = { data: true, error: null }
    render(<RemovedAccountNotice participantId="user-9" conversationId="conv-1" />)

    const note = await screen.findByTestId('removed-account-notice')
    expect(note).toHaveTextContent(REMOVED_ACCOUNT_NOTICE)
    expect(note).toHaveAttribute('role', 'note')
    expect(note.className).toContain('bg-surface-muted')
    expect(note.className).not.toMatch(/red|amber|danger|warning/)
    expect(rpcCalls).toEqual([{ fn: 'is_removed_account', args: { p_profile_id: 'user-9' } }])

    expect(screen.queryByTestId('report-sheet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(screen.getByTestId('report-sheet')).toHaveTextContent('chat:user-9:conv-1')
  })

  it('shows nothing for an ordinary account', async () => {
    render(<RemovedAccountNotice participantId="user-2" conversationId="conv-2" />)
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    expect(screen.queryByTestId('removed-account-notice')).not.toBeInTheDocument()
  })

  it('shows nothing when the backend cannot answer', async () => {
    rpcResult = { data: null, error: { message: 'function public.is_removed_account does not exist' } }
    render(<RemovedAccountNotice participantId="user-3" conversationId="conv-3" />)
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    expect(screen.queryByTestId('removed-account-notice')).not.toBeInTheDocument()
  })

  it('does not ask for a conversation that does not exist yet', () => {
    render(<RemovedAccountNotice participantId="user-4" conversationId="pending" enabled={false} />)
    expect(rpcCalls).toHaveLength(0)
    expect(screen.queryByTestId('removed-account-notice')).not.toBeInTheDocument()
  })
})
