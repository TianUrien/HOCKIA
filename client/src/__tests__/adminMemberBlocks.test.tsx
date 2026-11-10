import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Admin "Member blocks" (founder 2026-11-09): accounts other members blocked,
// most-blocked first, never who blocked them.

type Rpc = { fn: string; args: Record<string, unknown> | undefined }
let rpcCalls: Rpc[] = []
let blocks: { rows: unknown[]; total: number } = { rows: [], total: 0 }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'admin_get_member_blocks') return Promise.resolve({ data: blocks, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { AdminMemberBlocks } from '@/features/admin/pages/AdminMemberBlocks'

const row = (over: Record<string, unknown>) => ({
  profile_id: 'p1', full_name: 'Sam Example', role: 'player', avatar_url: null, account_created_at: '2026-10-18T09:00:00Z',
  block_count: 3, first_blocked_at: '2026-11-01T10:00:00Z', last_blocked_at: '2026-11-08T10:00:00Z',
  is_blocked: false, blocked_at: null, report_count: 1, signal_count: 0, ...over,
})

describe('AdminMemberBlocks', () => {
  beforeEach(() => { rpcCalls = []; blocks = { rows: [], total: 0 } })

  it('lists blocked members with how many members blocked them, and never who', async () => {
    blocks = { rows: [row({}), row({ profile_id: 'p2', full_name: 'Kim Example', block_count: 1, is_blocked: true })], total: 2 }
    render(<MemoryRouter><AdminMemberBlocks /></MemoryRouter>)
    expect(await screen.findByText('Sam Example')).toBeInTheDocument()
    expect(screen.getByTestId('blocks-p1').textContent).toBe('3 members')
    expect(screen.getByTestId('blocks-p2').textContent).toBe('1 member')
    expect(screen.getByText('Blocked by admin')).toBeInTheDocument()
    expect(rpcCalls[0]).toEqual({ fn: 'admin_get_member_blocks', args: { p_limit: 50, p_offset: 0 } })
    expect(screen.queryByText(/blocker/i)).toBeNull()
  })

  it('says so when nobody has blocked anyone', async () => {
    render(<MemoryRouter><AdminMemberBlocks /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No member has blocked anyone yet.')).toBeInTheDocument())
  })
})
