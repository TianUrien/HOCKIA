/**
 * List item / Career entry (Figma 558:12773): timeline line (hidden on the
 * last), muted placeholder for an entry without a crest (never initials or
 * another club's crest), at most two highlights, chevron only in Own mode.
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

import { CareerEntryItem } from '@/components/profile/mobile/CareerEntryItem'
import type { CareerTimelineEntry } from '@/hooks/useCareerTimeline'

const entry = (over: Partial<CareerTimelineEntry> = {}): CareerTimelineEntry => ({
  id: 'e1', entryType: 'club', clubName: 'Holcombe Hockey Club', positionRole: 'Defender & coach', divisionLeague: 'Division One South',
  locationCity: 'Rochester', locationCountry: 'England', startDate: '2025-07-01', endDate: '2025-12-01', years: null,
  highlights: ['Promoted with the 1st XI', 'Captain', 'Player of the season'], representedCountryId: null,
  crestUrl: 'https://example.com/holcombe.png', clubFlag: null, signedViaHockia: false, row: {} as CareerTimelineEntry['row'],
  ...over,
})
const renderItem = (props: Partial<Parameters<typeof CareerEntryItem>[0]> = {}) =>
  render(<ul><CareerEntryItem entry={entry()} last={false} flag={null} {...props} /></ul>)

describe('CareerEntryItem', () => {
  it('shows the team, "role · league" and "flag place · from – to"', () => {
    renderItem({ locationFlag: '🏴' })
    expect(screen.getByText('Holcombe Hockey Club')).toBeTruthy()
    expect(screen.getByText('Defender & coach · Division One South')).toBeTruthy()
    expect(screen.getByText('🏴 Rochester · Jul – Dec 2025')).toBeTruthy()
  })

  it('draws the timeline line down to the next entry, not on the last', () => {
    const { unmount } = renderItem({ last: false })
    expect(screen.getByTestId('career-entry-line')).toBeTruthy()
    unmount()
    renderItem({ last: true })
    expect(screen.queryByTestId('career-entry-line')).toBeNull()
  })

  it('shows at most two highlights, each with a check', () => {
    renderItem()
    const highlights = screen.getAllByTestId('career-entry-highlight')
    expect(highlights).toHaveLength(2)
    expect(highlights[0].textContent).toContain('Promoted with the 1st XI')
    expect(highlights[0].querySelector('svg.lucide-check')).not.toBeNull()
    expect(screen.queryByText('Player of the season')).toBeNull()
  })

  it('an entry with a crest shows that crest', () => {
    renderItem()
    const img = screen.getByTestId('career-entry-item').querySelector('img')
    expect(img?.getAttribute('src')).toContain('holcombe')
    expect(screen.queryByTestId('career-entry-placeholder')).toBeNull()
  })

  it('an entry without a crest shows a muted placeholder: no image, no initials', () => {
    renderItem({ entry: entry({ crestUrl: null }) })
    const placeholder = screen.getByTestId('career-entry-placeholder')
    expect(placeholder.className).toContain('bg-surface-muted')
    expect(placeholder.textContent).toBe('')
    expect(screen.getByTestId('career-entry-item').querySelector('img')).toBeNull()
  })

  it('a national team without a crest uses the same placeholder', () => {
    renderItem({ entry: entry({ crestUrl: null, entryType: 'national_team', clubName: 'Buenos Aires Selection 2024', divisionLeague: null, positionRole: 'Defender' }) })
    expect(screen.getByTestId('career-entry-placeholder')).toBeTruthy()
    expect(screen.getByText('Defender · representative team')).toBeTruthy()
  })

  it('Own mode: a chevron and the row opens the entry', () => {
    const onOpen = vi.fn()
    renderItem({ onOpen })
    expect(screen.getByTestId('career-entry-item').getAttribute('data-mode')).toBe('own')
    expect(screen.getByTestId('career-entry-chevron')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('Public mode: read-only, no chevron, no button', () => {
    renderItem()
    expect(screen.getByTestId('career-entry-item').getAttribute('data-mode')).toBe('public')
    expect(screen.queryByTestId('career-entry-chevron')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
