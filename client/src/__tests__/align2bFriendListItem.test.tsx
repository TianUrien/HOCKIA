/**
 * List item / Friend (Figma 555:4870): the trailing states and the GOLD
 * "Wrote a reference" pill — trust is gold, never green or amber.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    functions: { invoke: vi.fn() },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

import { FriendListItem, type FriendTrailing } from '@/components/ui/FriendListItem'

const renderRow = (trailing: FriendTrailing, showReference = false) =>
  render(<ul><FriendListItem name="Lucía Ferreiro" avatarUrl={null} role="player" meta="Player · Forward" flags="🇦🇷" showReference={showReference} trailing={trailing} /></ul>)

describe('FriendListItem', () => {
  it('shows name, meta and flags on the row', () => {
    renderRow({ kind: 'none' })
    expect(screen.getByText('Lucía Ferreiro')).toBeTruthy()
    expect(screen.getByText('Player · Forward')).toBeTruthy()
    expect(screen.getByTestId('friend-list-item').textContent).toContain('🇦🇷')
  })

  it('Ask = Tonal Small "Ask for reference" that fires its action', () => {
    const onClick = vi.fn()
    renderRow({ kind: 'ask', onClick })
    const ask = screen.getByRole('button', { name: 'Ask for reference' })
    expect(ask.className).toContain('bg-hockia-soft')
    expect(ask.className).toContain('h-9')
    fireEvent.click(ask)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Requested and Friends = grey pills with a check, not buttons', () => {
    const { unmount } = renderRow({ kind: 'requested' })
    const requested = screen.getByTestId('friend-trailing-requested')
    expect(requested.tagName).toBe('SPAN')
    expect(requested.className).toContain('bg-surface-grouped')
    expect(requested.querySelector('svg.lucide-check')).not.toBeNull()
    unmount()
    renderRow({ kind: 'friends' })
    const friends = screen.getByTestId('friend-trailing-friends')
    expect(friends.textContent).toContain('Friends')
    expect(friends.querySelector('svg.lucide-check')).not.toBeNull()
  })

  it('Add = Tonal Small with user-plus; the label can be Accept', () => {
    const onClick = vi.fn()
    const { unmount } = renderRow({ kind: 'add', onClick })
    const add = screen.getByTestId('friend-trailing-add')
    expect(add.className).toContain('bg-hockia-soft')
    expect(add.querySelector('svg.lucide-user-plus')).not.toBeNull()
    fireEvent.click(add)
    expect(onClick).toHaveBeenCalledTimes(1)
    unmount()
    renderRow({ kind: 'add', onClick, label: 'Accept' })
    expect(screen.getByRole('button', { name: 'Accept Lucía Ferreiro' })).toBeTruthy()
  })

  it('Wrote = "Wrote you a reference" in gold text, never green or amber', () => {
    renderRow({ kind: 'wrote' })
    const wrote = screen.getByTestId('friend-trailing-wrote')
    expect(wrote.textContent).toBe('Wrote you a reference')
    expect(wrote.className).toContain('text-gold')
    expect(wrote.className).not.toMatch(/positive|amber|green/)
  })

  it('the reference pill is gold and only shows when asked for', () => {
    const { unmount } = renderRow({ kind: 'friends' })
    expect(screen.queryByTestId('friend-reference-pill')).toBeNull()
    unmount()
    renderRow({ kind: 'friends' }, true)
    const pill = screen.getByTestId('friend-reference-pill')
    expect(pill.textContent).toContain('Wrote a reference')
    expect(pill.className).toContain('bg-gold-soft')
    expect(pill.className).toContain('text-gold')
    expect(pill.className).not.toMatch(/positive|amber|green/)
  })
})
