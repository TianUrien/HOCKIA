/**
 * D4 re-check (QA 2 Oct 2026):
 *  1. A career entry confirm_signing created carries the "Signed through
 *     Hockia" pill wherever the career renders.
 *  2. Withdrawn applications reach the club: under Closed with a grey
 *     "Withdrawn" tag, counted, read-only. Road applicants (offered …
 *     signed) stay under Shortlisted with their step tag.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applicantChipFor, closedApplicantTag } from '@/lib/signing'
import { appliedSinceLine, pipelineOf } from '@/lib/clubRecruiting'
import type { CareerTimelineEntry } from '@/hooks/useCareerTimeline'
import type { Applicant } from '@/hooks/useRoleApplicants'

const fx = vi.hoisted(() => ({
  career: [] as unknown[],
  applicants: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'club1' }, profile: { id: 'club1', role: 'club', full_name: 'E2E Test FC' } }
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }] }) }))
vi.mock('@/hooks/useCareerTimeline', () => ({
  useCareerTimeline: () => ({ entries: fx.career, loading: false, failed: false, refresh: vi.fn() }),
}))
vi.mock('@/hooks/useRoleApplicants', () => ({
  useRoleApplicants: () => ({
    loading: false, error: null, expiryDays: 14, refresh: vi.fn(), setLocalStatus: vi.fn(),
    role: { id: 'r1', club_id: 'club1', status: 'open', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', opportunity_type: 'player' },
    applicants: fx.applicants,
  }),
}))
vi.mock('@/components/club/RoleActions', () => ({ RoleActions: () => null }))

import CareerScreen from '@/components/profile/mobile/CareerScreen'
import ApplicantsScreen from '@/components/club/ApplicantsScreen'

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

const careerEntry = (p: Partial<CareerTimelineEntry>): CareerTimelineEntry => ({
  id: 'c1', entryType: 'club', clubName: 'E2E Test FC', positionRole: 'midfielder', divisionLeague: 'Primera', locationCity: 'Buenos Aires',
  locationCountry: null, startDate: '2026-10-01', endDate: null, years: '', highlights: [], representedCountryId: null, crestUrl: null, clubFlag: null,
  signedViaHockia: false,
  row: {} as CareerTimelineEntry['row'],
  ...p,
})

const person = (id: string, fullName: string): Applicant['person'] => ({
  id, fullName, avatarUrl: null, role: 'player', position: 'midfielder', secondaryPosition: null, nationalityCountryId: 1,
  nationality2CountryId: null, baseLocation: null, playingCategory: 'adult_men', lastActiveAt: null, currentClub: null, currentWorldClubId: null,
})
const applicant = (id: string, status: string, name: string, p: Partial<Applicant> = {}): Applicant => ({
  applicationId: id, status, appliedAt: '2026-09-20T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', metadata: {}, viewed: true, invited: false, fit: null,
  person: person(`p-${id}`, name), ...p,
})

beforeEach(() => {
  fx.career = []
  fx.applicants = []
})

describe('1 · career entry mark', () => {
  it('See all: the signed entry carries the pill, a normal one does not', () => {
    fx.career = [careerEntry({ id: 'c1', signedViaHockia: true }), careerEntry({ id: 'c2', clubName: 'Old Club', signedViaHockia: false })]
    inRouter(<CareerScreen profileId="p1" mode="public" onBack={vi.fn()} />)
    const pills = screen.getAllByTestId('signed-through-hockia')
    expect(pills).toHaveLength(1)
    expect(pills[0].textContent).toBe('Signed through Hockia')
    expect(pills[0].closest('li')?.textContent).toContain('E2E Test FC')
  })

  it('own view shows the same pill', () => {
    fx.career = [careerEntry({ signedViaHockia: true })]
    inRouter(<CareerScreen profileId="p1" mode="own" onBack={vi.fn()} />)
    expect(screen.getByTestId('signed-through-hockia')).toBeTruthy()
  })
})

describe('2 · withdrawn applicants reach the club', () => {
  it('withdrawn and filled sit under Closed; the road stays under Shortlisted', () => {
    expect(applicantChipFor('withdrawn')).toBe('no_response')
    expect(applicantChipFor('filled')).toBe('no_response')
    expect(applicantChipFor('no_response')).toBe('no_response')
    expect(applicantChipFor('signed')).toBe('shortlisted')
    expect(closedApplicantTag('withdrawn')).toBe('Withdrawn')
    expect(closedApplicantTag('filled')).toBe('Role filled')
    expect(closedApplicantTag('no_response')).toBeNull()
  })

  it('counts withdrawn in the header and the Closed total', () => {
    const p = pipelineOf(['pending', 'withdrawn', 'no_response', 'signed'])
    expect(p.closed).toBe(2)
    expect(p.withdrawn).toBe(1)
    expect(p.total).toBe(4)
    expect(appliedSinceLine([{ status: 'withdrawn', appliedAt: '2026-09-12T00:00:00Z' }, { status: 'pending', appliedAt: '2026-09-20T00:00:00Z' }], () => 'Sep 12')).toBe('2 applied since Sep 12')
  })

  it('Applicants: Closed chip counts and lists the withdrawn row with a grey Withdrawn tag', () => {
    fx.applicants = [
      applicant('a1', 'pending', 'Guido Piergiacomi', { viewed: false }),
      applicant('a2', 'withdrawn', 'Facundo Diaz'),
      applicant('a3', 'offered', 'Ana Pérez'),
    ]
    inRouter(<ApplicantsScreen roleId="r1" />)
    expect(screen.getByText(/3 applied since/)).toBeTruthy()
    // To review holds only the pending one.
    expect(screen.getAllByTestId('applicant-row')).toHaveLength(1)
    expect(screen.queryByTestId('applicant-status-tag')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Closed · 1' }))
    const closed = screen.getAllByTestId('applicant-row')
    expect(closed).toHaveLength(1)
    expect(closed[0].textContent).toContain('Facundo Diaz')
    const tag = closed[0].querySelector('[data-testid="applicant-status-tag"]')
    expect(tag?.textContent).toBe('Withdrawn')
    expect(tag?.className).not.toMatch(/amber/)
    expect(screen.getByText(/withdrawn by the applicant/)).toBeTruthy()

    // The offered applicant stays under Shortlisted with the step as a grey tag.
    fireEvent.click(screen.getByRole('tab', { name: 'Shortlisted' }))
    const shortlisted = screen.getAllByTestId('applicant-row')
    expect(shortlisted).toHaveLength(1)
    expect(shortlisted[0].textContent).toContain('Ana Pérez')
    expect(shortlisted[0].querySelector('[data-testid="applicant-status-tag"]')?.textContent).toBe('Offer sent')
  })
})
