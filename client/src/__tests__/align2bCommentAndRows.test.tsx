/**
 * List item / Comment (Figma 567:569) and Detail row (467:128).
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

import { CommentListItem } from '@/components/ui/CommentListItem'
import { DetailRowItem } from '@/components/ui/DetailRowItem'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'

describe('CommentListItem', () => {
  it('puts the name and "role · time" on one line, then the text', () => {
    render(<ul><CommentListItem name="ZAHRA" avatarUrl={null} role="player" meta="Player · 2h" text="Qué golazo el segundo" /></ul>)
    const name = screen.getByText('ZAHRA')
    const meta = screen.getByTestId('comment-meta')
    expect(meta.textContent).toBe('Player · 2h')
    expect(name.parentElement).toBe(meta.parentElement)
    expect(name.parentElement?.className).toContain('flex')
    expect(screen.getByText('Qué golazo el segundo')).toBeTruthy()
  })

  it('uses the 32 px avatar and renders the actions slot', () => {
    render(<ul><CommentListItem name="Florencia" avatarUrl={null} meta="Player · 40m" text="Vamos" actions={<button type="button">Report</button>} /></ul>)
    expect(screen.getByTestId('comment-list-item').querySelector('.w-8.h-8')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Report' })).toBeTruthy()
  })
})

describe('DetailRowItem', () => {
  it('with onClick is a button with a chevron', () => {
    const onClick = vi.fn()
    render(<DetailRowItem label="Name" value="Valentina Turienzo" onClick={onClick} />)
    const row = screen.getByRole('button')
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('locked shows a lock and is not a button', () => {
    render(<DetailRowItem label="Role" value="Player" locked onClick={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('detail-row-item').querySelector('svg.lucide-lock')).not.toBeNull()
  })

  it('shows the placeholder in ink-3 and the secondary second line', () => {
    const { unmount } = render(<DetailRowItem label="Skills" value={null} placeholder="Add" />)
    expect(screen.getByTestId('detail-row-value').textContent).toBe('Add')
    expect(screen.getByTestId('detail-row-value').className).toContain('text-ink-3')
    unmount()
    render(<DetailRowItem label="Passports" value="Argentina · Spain" sub="EU passport" />)
    expect(screen.getByTestId('detail-row-sub').textContent).toBe('EU passport')
    expect(screen.getByTestId('detail-row-sub').className).toContain('text-ink-2')
  })
})

describe('SwitchCardRow', () => {
  it('is one switch with the title as its name', () => {
    const onChange = vi.fn()
    render(<SwitchCardRow title="Only roles my passports qualify for" description="Argentine — 4 of 14 open roles" checked onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Only roles my passports qualify for' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Argentine — 4 of 14 open roles')).toBeTruthy()
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
