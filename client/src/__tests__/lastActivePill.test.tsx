/**
 * LastActivePill — privacy + bucketing tests.
 *
 * Pins the privacy contract documented in the component:
 *   - Anonymous viewers see nothing (auth-only)
 *   - Bucketed labels only — no exact timestamps
 *   - Silent on stale (> 30 days) profiles, not "Last seen 6 months ago"
 */

import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

const authState = vi.hoisted(() => ({
  user: { id: 'viewer-1' } as { id: string } | null,
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: <T,>(selector: (s: typeof authState) => T) => selector(authState),
}))

import LastActivePill from '@/components/LastActivePill'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const nowMinus = (ms: number): string => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { id: 'viewer-1' }
})

describe('LastActivePill — privacy gate', () => {
  it('renders nothing for an anonymous viewer (no auth)', () => {
    authState.user = null
    const { container } = render(
      <LastActivePill lastActiveAt={nowMinus(2 * HOUR)} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when lastActiveAt is null (never seen)', () => {
    const { container } = render(<LastActivePill lastActiveAt={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when lastActiveAt is undefined', () => {
    const { container } = render(<LastActivePill lastActiveAt={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when lastActiveAt is malformed (NaN guard)', () => {
    const { container } = render(<LastActivePill lastActiveAt="not-a-date" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for stale profiles (> 30 days inactive)', () => {
    // No "Last seen 90 days ago" stigma label — silent absence.
    const { container } = render(
      <LastActivePill lastActiveAt={nowMinus(45 * DAY)} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('LastActivePill — bucket selection', () => {
  it('shows "Active today" for activity within the last 24h', () => {
    render(<LastActivePill lastActiveAt={nowMinus(2 * HOUR)} />)
    expect(screen.getByText('Active today')).toBeInTheDocument()
  })

  it('shows "Active this week" for activity in 1-7 days', () => {
    render(<LastActivePill lastActiveAt={nowMinus(3 * DAY)} />)
    expect(screen.getByText('Active this week')).toBeInTheDocument()
  })

  it('shows "Active this month" for activity in 7-30 days', () => {
    render(<LastActivePill lastActiveAt={nowMinus(15 * DAY)} />)
    expect(screen.getByText('Active this month')).toBeInTheDocument()
  })

  it('switches buckets at the 24h boundary', () => {
    // Just under 24h → today
    const { unmount } = render(
      <LastActivePill lastActiveAt={nowMinus(23 * HOUR)} />,
    )
    expect(screen.getByText('Active today')).toBeInTheDocument()
    unmount()

    // Just over 24h → this week
    render(<LastActivePill lastActiveAt={nowMinus(25 * HOUR)} />)
    expect(screen.getByText('Active this week')).toBeInTheDocument()
  })

  it('NEVER exposes an exact timestamp or "X minutes ago"', () => {
    // Render every bucket. None of them should contain numeric time
    // expressions or the word "ago" — guards against future regressions
    // that try to replace the bucket with precise relative time.
    const samples = [
      nowMinus(30 * 60 * 1000), // 30 min
      nowMinus(5 * HOUR),
      nowMinus(2 * DAY),
      nowMinus(20 * DAY),
    ]
    for (const ts of samples) {
      const { container, unmount } = render(<LastActivePill lastActiveAt={ts} />)
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/\bago\b/i)
      expect(text).not.toMatch(/\d+\s*(minute|hour|day|week|month|year)s?/i)
      unmount()
    }
  })
})
