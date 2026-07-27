import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ProfileActionMenu from '@/components/ProfileActionMenu'

/**
 * The block-state fence.
 *
 * ProfileActionMenu is REUSED across profiles — same position in the tree,
 * changing targetId — so blocked state must be re-derived per target, never
 * accumulated. The original only ever called setBlocked(true), never false, so
 * after visiting a blocked profile every later profile's menu offered
 * "Unblock User" and hid "Block User": you could not block that person at all.
 *
 * NOTE: StrictMode double-invokes effects, so these assert on the rendered
 * outcome and key the mock on the target id — never on call counts.
 */

const h = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: { id: 'viewer-1' }, profile: { id: 'viewer-1', role: 'player' } }
    return typeof sel === 'function' ? sel(state) : state
  },
}))
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))

/** Answer per target id, so effect double-invocation is harmless. */
function answerBlocked(blocked: Set<string>) {
  h.rpc.mockImplementation((_fn: string, args: { p_other_id?: string }) =>
    Promise.resolve({ data: blocked.has(args?.p_other_id ?? '') }),
  )
}

function menu(targetId: string) {
  return (
    <MemoryRouter>
      <ProfileActionMenu targetId={targetId} targetName="Someone" />
    </MemoryRouter>
  )
}

function openMenu() {
  fireEvent.click(screen.getAllByRole('button')[0])
}

beforeEach(() => {
  h.rpc.mockReset()
})

describe('ProfileActionMenu — blocked state per target', () => {
  it('offers Block for a target that is NOT blocked', async () => {
    answerBlocked(new Set())
    render(menu('target-a'))
    openMenu()
    await waitFor(() => expect(screen.getByText('Block User')).toBeInTheDocument())
    expect(screen.queryByText('Unblock User')).not.toBeInTheDocument()
  })

  it('offers Unblock for a target that IS blocked', async () => {
    answerBlocked(new Set(['target-b']))
    render(menu('target-b'))
    openMenu()
    await waitFor(() => expect(screen.getByText('Unblock User')).toBeInTheDocument())
  })

  it('RE-DERIVES on target change: blocked → not blocked must offer Block again', async () => {
    // The regression: a sticky `true` carried across targets, so the second
    // profile could never be blocked — the UI thought it already was.
    answerBlocked(new Set(['target-blocked']))
    const { rerender } = render(menu('target-blocked'))
    openMenu()
    await waitFor(() => expect(screen.getByText('Unblock User')).toBeInTheDocument())

    rerender(menu('target-clean'))
    await waitFor(() => expect(screen.getByText('Block User')).toBeInTheDocument())
    expect(screen.queryByText('Unblock User')).not.toBeInTheDocument()
  })

  it('ignores a STALE response that resolves after the target changed', async () => {
    // target-a is blocked and answers slowly; target-b is clean and fast.
    // Without the cancellation guard a's late `true` lands last and wins.
    const late: Array<(v: { data: boolean }) => void> = []
    h.rpc.mockImplementation((_fn: string, args: { p_other_id?: string }) => {
      if (args?.p_other_id === 'target-a') {
        return new Promise<{ data: boolean }>((res) => { late.push(res) })
      }
      return Promise.resolve({ data: false })
    })

    const { rerender } = render(menu('target-a'))
    rerender(menu('target-b'))
    await waitFor(() => expect(h.rpc).toHaveBeenCalled())

    late.forEach((res) => res({ data: true })) // stale answers land last
    await new Promise((r) => setTimeout(r, 30))

    openMenu()
    await waitFor(() => expect(screen.getByText('Block User')).toBeInTheDocument())
    expect(screen.queryByText('Unblock User')).not.toBeInTheDocument()
  })
})
