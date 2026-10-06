/**
 * Filter sheets (Figma 115:550 Opportunities, 116:631 Community): every
 * option is the shared Chip, Reset is a link, the passport toggle is a switch
 * row and the Primary button carries the live count.
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

import { OpportunityFiltersSheet } from '@/components/opportunities/OpportunityFiltersSheet'
import { CommunityFiltersDrawer } from '@/components/community/CommunityFiltersDrawer'
import { defaultFilters, type CommunityFiltersState } from '@/components/community/communityFilters'
import { EMPTY_ROLE_FILTERS, type RoleFilters } from '@/lib/opportunityFilters'

describe('OpportunityFiltersSheet', () => {
  const renderSheet = (over: Partial<Parameters<typeof OpportunityFiltersSheet>[0]> = {}) => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <OpportunityFiltersSheet open onClose={onClose} value={{ ...EMPTY_ROLE_FILTERS, type: 'player' }} onApply={onApply}
        countFor={(d: RoleFilters) => (d.position ? 2 : 6)} passportHint="Argentine — 4 of 14 open roles" {...over} />,
    )
    return { onApply, onClose }
  }

  it('options are Chips: selected soft purple, never black', () => {
    renderSheet()
    const selected = screen.getByRole('button', { name: 'Player roles' })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.className).toContain('bg-brand-soft')
    expect(selected.className).not.toContain('bg-ink-1')
    const idle = screen.getByRole('button', { name: 'Housing' })
    expect(idle.getAttribute('aria-pressed')).toBe('false')
    expect(idle.className).toContain('bg-surface-grouped')
  })

  it('the button shows the live count of the draft and applies it', () => {
    const { onApply, onClose } = renderSheet()
    expect(screen.getByTestId('opportunity-filter-show').textContent).toBe('Show 6 roles')
    fireEvent.click(screen.getByRole('button', { name: 'Defender' }))
    const show = screen.getByTestId('opportunity-filter-show')
    expect(show.textContent).toBe('Show 2 roles')
    expect(show.className).toContain('bg-hockia-primary')
    fireEvent.click(show)
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ position: 'defender', type: 'player' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says "Show 1 role" for one', () => {
    renderSheet({ countFor: () => 1 })
    expect(screen.getByTestId('opportunity-filter-show').textContent).toBe('Show 1 role')
  })

  it('the passport toggle is a switch row with its sub-line; hidden without a hint', () => {
    const { onApply } = renderSheet()
    const sw = screen.getByRole('switch', { name: 'Only roles my passports qualify for' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Argentine — 4 of 14 open roles')).toBeTruthy()
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('opportunity-filter-show'))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ eligibleOnly: true }))
  })

  it('no passport hint, no toggle', () => {
    renderSheet({ passportHint: null })
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('Reset is a text link that clears the draft', () => {
    renderSheet()
    const reset = screen.getByRole('button', { name: 'Reset' })
    expect(reset.className).toContain('text-hockia-primary')
    fireEvent.click(reset)
    expect(screen.getByRole('button', { name: 'Player roles' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('CommunityFiltersDrawer', () => {
  const state = (over: Partial<CommunityFiltersState> = {}): CommunityFiltersState => ({
    searchQuery: '', setSearchQuery: vi.fn(),
    filters: { ...defaultFilters('player'), position: ['forward'] },
    updateFilter: vi.fn() as CommunityFiltersState['updateFilter'], clearFilters: vi.fn(), togglePosition: vi.fn(),
    showFilters: true, setShowFilters: vi.fn(), sort: 'newest' as CommunityFiltersState['sort'], setSort: vi.fn(),
    applyContextFit: false, setApplyContextFit: vi.fn(), hasActiveFilters: true, isNarrowed: true,
    ...over,
  })

  it('options are Chips with the soft purple selected state', () => {
    render(<CommunityFiltersDrawer state={state()} resultCount={118} onSelectRole={vi.fn()} />)
    const forward = screen.getByRole('button', { name: 'Forward' })
    expect(forward.getAttribute('aria-pressed')).toBe('true')
    expect(forward.className).toContain('bg-brand-soft')
    expect(screen.getByRole('button', { name: 'Players' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Coaches' }).className).toContain('bg-surface-grouped')
  })

  it('the Primary button shows the live member count and closes the sheet', () => {
    const s = state()
    render(<CommunityFiltersDrawer state={s} resultCount={118} onSelectRole={vi.fn()} />)
    const show = screen.getByTestId('community-filter-show')
    expect(show.textContent).toBe('Show 118 members')
    expect(show.className).toContain('bg-hockia-primary')
    fireEvent.click(show)
    expect(s.setShowFilters).toHaveBeenCalledWith(false)
  })

  it('counts: one member, and no count yet', () => {
    const { unmount } = render(<CommunityFiltersDrawer state={state()} resultCount={1} onSelectRole={vi.fn()} />)
    expect(screen.getByTestId('community-filter-show').textContent).toBe('Show 1 member')
    unmount()
    render(<CommunityFiltersDrawer state={state()} resultCount={null} onSelectRole={vi.fn()} />)
    expect(screen.getByTestId('community-filter-show').textContent).toBe('Show members')
  })

  it('the EU passport toggle is a switch row that writes the filter', () => {
    const s = state()
    render(<CommunityFiltersDrawer state={s} resultCount={10} onSelectRole={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Only members with an EU passport' }))
    expect(s.updateFilter).toHaveBeenCalledWith('euOnly', true)
  })

  it('a chip tap writes through the same handlers', () => {
    const s = state()
    const onSelectRole = vi.fn()
    render(<CommunityFiltersDrawer state={s} resultCount={10} onSelectRole={onSelectRole} />)
    fireEvent.click(screen.getByRole('button', { name: 'Defender' }))
    expect(s.togglePosition).toHaveBeenCalledWith('defender')
    fireEvent.click(screen.getByRole('button', { name: 'Clubs' }))
    expect(onSelectRole).toHaveBeenCalledWith('club')
  })
})
