import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retention cards (D7 / D15 / D30) on the Overview.
 *
 * The maths lives in Postgres (src/__tests__/db/retention.test.ts); what is
 * tested here is the part that made the old single D7 card misleading:
 * a percentage with no denominator, and a 0% that actually meant "nobody is
 * old enough to measure yet".
 */
const mocks = vi.hoisted(() => ({ getRetentionSummary: vi.fn() }))
vi.mock('@/features/admin/api/retentionApi', () => ({
  getRetentionSummary: mocks.getRetentionSummary,
  DEFAULT_RETENTION_DAYS: [7, 15, 30],
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { RetentionSignals } from '@/features/admin/components/RetentionSignals'
import type { RetentionCheckpoint, RetentionSummary } from '@/features/admin/types/retention'

const checkpoint = (over: Partial<RetentionCheckpoint> & { day: number }): RetentionCheckpoint => ({
  cohort_size: 80,
  eligible: 72,
  retained: 24,
  pct: 33.3,
  prev_eligible: 60,
  prev_retained: 15,
  prev_pct: 25,
  delta_pts: 8.3,
  ...over,
})

const summary = (checkpoints: RetentionCheckpoint[]): RetentionSummary => ({
  method: 'bracket',
  activity: 'any',
  timezone: 'UTC',
  period_days: 90,
  cohort_from: '2026-05-29',
  cohort_to: '2026-08-27',
  generated_at: '2026-08-27T00:00:00Z',
  checkpoints,
})

const mount = () => render(<MemoryRouter><RetentionSignals /></MemoryRouter>)

describe('RetentionSignals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows all three checkpoints, each with its numerator and eligible denominator', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([
        checkpoint({ day: 7, retained: 24, eligible: 72, pct: 33.3 }),
        checkpoint({ day: 15, retained: 14, eligible: 66, pct: 21.2 }),
        checkpoint({ day: 30, retained: 8, eligible: 51, pct: 15.7 }),
      ]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())

    expect(screen.getByTestId('retention-card-d7')).toHaveTextContent('33.3%')
    expect(screen.getByTestId('retention-card-d7')).toHaveTextContent('24 of 72 eligible')
    expect(screen.getByTestId('retention-card-d15')).toHaveTextContent('14 of 66 eligible')
    expect(screen.getByTestId('retention-card-d30')).toHaveTextContent('8 of 51 eligible')
  })

  it('an immature cohort reads N/A — never 0%', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([
        checkpoint({ day: 7, retained: 24, eligible: 72, pct: 33.3 }),
        checkpoint({ day: 30, retained: 0, eligible: 0, pct: null, cohort_size: 12, delta_pts: null, prev_pct: null }),
      ]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d30')).toBeInTheDocument())

    const d30 = screen.getByTestId('retention-card-d30')
    expect(d30).toHaveTextContent('N/A')
    expect(d30).toHaveTextContent(/not enough eligible data/i)
    expect(d30).toHaveTextContent('12 still maturing')
    expect(d30).not.toHaveTextContent('0%')
  })

  it('a real zero is shown as 0% with its denominator, not hidden', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([checkpoint({ day: 7, retained: 0, eligible: 41, pct: 0, delta_pts: -12 })]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())

    const d7 = screen.getByTestId('retention-card-d7')
    expect(d7).toHaveTextContent('0%')
    expect(d7).toHaveTextContent('0 of 41 eligible')
    expect(d7).not.toHaveTextContent('N/A')
  })

  it('shows the change against the preceding equal-length period, signed', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([
        checkpoint({ day: 7, delta_pts: 8.3 }),
        checkpoint({ day: 15, delta_pts: -4.1 }),
      ]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())

    expect(screen.getByTestId('retention-card-d7')).toHaveTextContent('+8.3 pts')
    expect(screen.getByTestId('retention-card-d15')).toHaveTextContent('-4.1 pts')
  })

  it('omits the delta when the previous period had nobody eligible', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([checkpoint({ day: 7, delta_pts: null, prev_pct: null, prev_eligible: 0 })]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())
    expect(screen.getByTestId('retention-card-d7')).not.toHaveTextContent('pts')
  })

  it('flags a small eligible cohort instead of presenting it as a rate', async () => {
    mocks.getRetentionSummary.mockResolvedValue(
      summary([checkpoint({ day: 7, retained: 4, eligible: 6, pct: 66.7 })]),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())

    const d7 = screen.getByTestId('retention-card-d7')
    expect(d7).toHaveTextContent('66.7%')
    expect(d7).toHaveTextContent('4 of 6 eligible')
    expect(d7).toHaveTextContent(/small cohort/i)
  })

  it('renders loading, then error, then empty states distinctly', async () => {
    // loading
    mocks.getRetentionSummary.mockReturnValue(new Promise(() => {}))
    const { unmount } = mount()
    expect(screen.getByTestId('retention-loading')).toBeInTheDocument()
    unmount()

    // error
    mocks.getRetentionSummary.mockRejectedValue(new Error('boom'))
    const { unmount: u2 } = mount()
    await waitFor(() => expect(screen.getByTestId('retention-error')).toBeInTheDocument())
    u2()

    // empty
    mocks.getRetentionSummary.mockResolvedValue(summary([]))
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-empty')).toBeInTheDocument())
  })

  it('links through to the detailed cohort analysis', async () => {
    mocks.getRetentionSummary.mockResolvedValue(summary([checkpoint({ day: 7 })]))
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /cohorts & segments/i })).toHaveAttribute(
      'href',
      '/admin/product-health/retention',
    )
  })

  it('states the method, activity and timezone so the number cannot be misread', async () => {
    mocks.getRetentionSummary.mockResolvedValue(summary([checkpoint({ day: 7 })]))
    mount()
    await waitFor(() => expect(screen.getByTestId('retention-card-d7')).toBeInTheDocument())
    expect(screen.getByText(/days N–N\+6/i)).toBeInTheDocument()
    expect(screen.getByText(/UTC/)).toBeInTheDocument()
  })
})
