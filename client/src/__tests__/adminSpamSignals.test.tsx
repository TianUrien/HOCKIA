import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Admin "Spam signals": the list, the existing block action and the safety notice.

type Rpc = { fn: string; args: Record<string, unknown> | undefined }
let rpcCalls: Rpc[] = []
let signals: { rows: unknown[]; total: number } = { rows: [], total: 0 }
let noticeResult: { data: unknown; error: { message: string } | null } = { data: 3, error: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'admin_get_spam_signals') return Promise.resolve({ data: signals, error: null })
      if (fn === 'admin_send_removed_account_notice') return Promise.resolve(noticeResult)
      return Promise.resolve({ data: null, error: null })
    },
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { AdminSpamSignals } from '@/features/admin/pages/AdminSpamSignals'

const repeated = {
  id: 'sig-1',
  kind: 'repeated_first_message',
  people_count: 7,
  identical_count: 5,
  refusal_count: 0,
  sample_text: 'Hello, I can offer you a contract. Write to me on another app.',
  first_seen_at: '2026-10-01T10:00:00Z',
  last_seen_at: '2026-10-03T12:30:00Z',
  profile_id: 'profile-a',
  full_name: 'Alex Example',
  role: 'coach',
  account_created_at: '2026-09-29T09:00:00Z',
  is_blocked: false,
  blocked_at: null,
  removed_at: null,
  notice_sent_at: null,
  notice_count: null,
}

const daily = {
  ...repeated,
  id: 'sig-2',
  kind: 'daily_limit',
  people_count: 5,
  identical_count: null,
  refusal_count: 4,
  sample_text: null,
  profile_id: 'profile-b',
  full_name: 'Sam Sample',
  role: 'player',
  is_blocked: true,
  blocked_at: '2026-10-03T13:00:00Z',
  removed_at: '2026-10-03T13:05:00Z',
  notice_sent_at: '2026-10-03T13:05:00Z',
  notice_count: 12,
}

const renderPage = () => render(<MemoryRouter><AdminSpamSignals /></MemoryRouter>)

const openRowAction = async (rowName: string, action: string) => {
  const row = screen.getByText(rowName).closest('tr') as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: 'Open actions menu' }))
  await userEvent.click(await screen.findByRole('button', { name: action }))
}

beforeEach(() => {
  rpcCalls = []
  signals = { rows: [repeated, daily], total: 2 }
  noticeResult = { data: 3, error: null }
})

describe('AdminSpamSignals', () => {
  it('shows "No signals." when there is nothing', async () => {
    signals = { rows: [], total: 0 }
    renderPage()
    expect(await screen.findByText('No signals.')).toBeInTheDocument()
    expect(rpcCalls[0]).toEqual({ fn: 'admin_get_spam_signals', args: { p_days: 30, p_limit: 50, p_offset: 0 } })
  })

  it('lists who, the signal, how many people and when, linking to the member', async () => {
    renderPage()
    const who = await screen.findByRole('link', { name: 'Alex Example' })
    expect(who).toHaveAttribute('href', '/admin/directory?profile=profile-a')

    const first = who.closest('tr') as HTMLElement
    expect(within(first).getByText('Same first message to many people')).toBeInTheDocument()
    expect(within(first).getByText(/Hello, I can offer you a contract/)).toBeInTheDocument()
    expect(within(first).getByText('7 people')).toBeInTheDocument()
    expect(within(first).getByText('5 identical')).toBeInTheDocument()
    expect(within(first).getByText('Not sent')).toBeInTheDocument()

    const second = screen.getByText('Sam Sample').closest('tr') as HTMLElement
    expect(within(second).getByText('Reached the daily limit')).toBeInTheDocument()
    expect(within(second).getByText('5 people')).toBeInTheDocument()
    expect(within(second).getByText('4 refused after')).toBeInTheDocument()
    expect(within(second).getByText('Blocked')).toBeInTheDocument()
    expect(within(second).getByText(/Sent to 12 people/)).toBeInTheDocument()
  })

  it('sends the safety notice for a blocked account only after the confirmation and shows how many were sent', async () => {
    renderPage()
    await screen.findByText('Sam Sample')
    await openRowAction('Sam Sample', 'Send safety notice')

    expect(screen.getByText('Send the safety notice to everyone this account messaged?')).toBeInTheDocument()
    expect(rpcCalls.some((c) => c.fn === 'admin_send_removed_account_notice')).toBe(false)

    const buttons = screen.getAllByRole('button', { name: 'Send safety notice' })
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(screen.getByTestId('notice-sent-sig-2')).toHaveTextContent('Sent to 3 people'))
    expect(rpcCalls.filter((c) => c.fn === 'admin_send_removed_account_notice')).toEqual([
      { fn: 'admin_send_removed_account_notice', args: { p_removed_profile_id: 'profile-b' } },
    ])
  })

  it('disables "Send safety notice" for an account that is not blocked, with a hint', async () => {
    renderPage()
    await screen.findByText('Alex Example')
    const row = screen.getByText('Alex Example').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Open actions menu' }))

    const send = await screen.findByRole('button', { name: 'Send safety notice' })
    expect(send).toBeDisabled()
    expect(screen.getByText('Block the account first.')).toBeInTheDocument()

    await userEvent.click(send)
    expect(screen.queryByText('Send the safety notice to everyone this account messaged?')).not.toBeInTheDocument()
    expect(rpcCalls.some((c) => c.fn === 'admin_send_removed_account_notice')).toBe(false)
  })

  it('keeps "Send safety notice" enabled, without the hint, for a blocked account', async () => {
    renderPage()
    await screen.findByText('Sam Sample')
    const row = screen.getByText('Sam Sample').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Open actions menu' }))

    expect(await screen.findByRole('button', { name: 'Send safety notice' })).toBeEnabled()
    expect(screen.queryByText('Block the account first.')).not.toBeInTheDocument()
  })

  it('says so when the notice cannot be sent, and shows no count', async () => {
    noticeResult = { data: null, error: { message: 'Block the account first.' } }
    renderPage()
    await screen.findByText('Sam Sample')
    await openRowAction('Sam Sample', 'Send safety notice')
    const buttons = screen.getAllByRole('button', { name: 'Send safety notice' })
    await userEvent.click(buttons[buttons.length - 1])

    expect(await screen.findByText('Failed to send the safety notice: Block the account first.')).toBeInTheDocument()
    expect(screen.queryByTestId('notice-sent-sig-2')).not.toBeInTheDocument()
  })

  it('blocks through the existing admin block action after the confirmation', async () => {
    renderPage()
    await screen.findByText('Alex Example')
    await openRowAction('Alex Example', 'Block user')

    expect(screen.getByText(/Are you sure you want to block "Alex Example"\?/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Block User' }))

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'admin_block_user')).toBe(true))
    expect(rpcCalls.find((c) => c.fn === 'admin_block_user')?.args).toEqual({
      p_profile_id: 'profile-a',
      p_reason: 'Spam signal: same first message to many people',
    })
  })
})
