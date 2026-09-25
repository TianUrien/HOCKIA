import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { vi, describe, it, expect } from 'vitest'

/**
 * Club Pulse nudge (founder 2026-09-26): one generic line, no responsiveness
 * read — the club is never told it's "fast" or "slow".
 */
const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => fromSpy(t) } }))
vi.mock('@/lib/homeInstrumentation', () => ({
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
  useImpressionOnce: () => () => {},
}))

import { ApplicantsToReview } from '@/components/home/pulse/ApplicantsToReview'
import type { RolesHealthTotals } from '@/hooks/useRolesHealth'

const totals = { pending: 3, newApplicants: 1 } as unknown as RolesHealthTotals

describe('ApplicantsToReview nudge', () => {
  it('shows the single generic line and never reads publisher_responsiveness', () => {
    render(
      <MemoryRouter>
        <ApplicantsToReview totals={totals} loading={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Answer every applicant. Players remember the clubs that reply.')).toBeInTheDocument()
    expect(screen.queryByText(/respond fast|quick replies|within 3 days/i)).toBeNull()
    expect(fromSpy).not.toHaveBeenCalledWith('publisher_responsiveness')
  })

  it('keeps the club-side "waiting for a reply" headline (viewer must act)', () => {
    render(
      <MemoryRouter>
        <ApplicantsToReview totals={totals} loading={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/3 applicants waiting for a reply/)).toBeInTheDocument()
  })

  it('the responsiveness hook is gone from the client', () => {
    expect(existsSync(resolve(__dirname, '../hooks/usePublisherResponsiveness.ts'))).toBe(false)
    const src = readFileSync(resolve(__dirname, '../components/home/pulse/ApplicantsToReview.tsx'), 'utf-8')
    expect(src).not.toMatch(/publisher_responsiveness|usePublisherResponsiveness/)
  })
})
