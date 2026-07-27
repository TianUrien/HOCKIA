import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useHomeTab } from '@/hooks/useHomeTab'
import { HomeTabBar } from '@/components/home/HomeTabs'

/**
 * Feed is the default Home tab (founder call, 2026-07-27). That inverted which
 * value the URL carries — the DEFAULT tab is the one with no param — so these
 * tests pin the whole contract, including the backwards-compatible reading of
 * ?tab=feed, which still exists in links out in the wild.
 */

vi.mock('@/lib/homeInstrumentation', () => ({ trackModuleClick: vi.fn() }))

function Harness() {
  const [tab, setTab] = useHomeTab()
  const loc = useLocation()
  return (
    <>
      <span data-testid="tab">{tab}</span>
      <span data-testid="search">{loc.search || '(none)'}</span>
      <HomeTabBar tab={tab} onChange={setTab} />
    </>
  )
}

function mount(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  )
}

describe('Home tab', () => {
  it('defaults to FEED on a bare /home', () => {
    mount('/home')
    expect(screen.getByTestId('tab')).toHaveTextContent('feed')
  })

  it('honours ?tab=pulse', () => {
    mount('/home?tab=pulse')
    expect(screen.getByTestId('tab')).toHaveTextContent('pulse')
  })

  it('still honours ?tab=feed — links in the wild use it', () => {
    // The Pulse "Happening now" card navigates to /home?tab=feed, and older
    // links may too. Flipping the default must not orphan them.
    mount('/home?tab=feed')
    expect(screen.getByTestId('tab')).toHaveTextContent('feed')
  })

  it('renders Feed FIRST in the switch', () => {
    mount('/home')
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['feed', 'pulse'])
  })

  it('marks the active tab for assistive tech', () => {
    mount('/home')
    expect(screen.getByRole('button', { name: 'feed' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'pulse' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switching to Pulse puts ?tab=pulse in the URL; returning to Feed clears it', () => {
    mount('/home')
    fireEvent.click(screen.getByRole('button', { name: 'pulse' }))
    expect(screen.getByTestId('tab')).toHaveTextContent('pulse')
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=pulse')

    fireEvent.click(screen.getByRole('button', { name: 'feed' }))
    expect(screen.getByTestId('tab')).toHaveTextContent('feed')
    // Default tab => no param, so /home is canonical for the landing state.
    expect(screen.getByTestId('search')).toHaveTextContent('(none)')
  })
})
