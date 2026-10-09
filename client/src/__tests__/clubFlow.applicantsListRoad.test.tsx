/**
 * Desktop v1 applicants list: every application status renders somewhere and
 * the header count matches the cards. Applicants on the offer / signing road
 * (offered, accepted, signed_pending_confirmation, signed) sit in a read-only
 * "Offer & signing" group with the phone road's grey tag (clubRoadTag).
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { Database } from '@/lib/database.types'
import { Constants } from '@/lib/database.types'
import { clubRoadTag } from '@/lib/signing'

type ApplicationStatus = Database['public']['Enums']['application_status']

const ALL_STATUSES = Constants.public.Enums.application_status as readonly ApplicationStatus[]

const fx = vi.hoisted(() => ({
  apps: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => {
      if (table === 'opportunities') {
        return { data: { id: 'opp-1', title: 'Defender 2026–27', club_id: 'club-1', status: 'open' }, error: null }
      }
      if (table === 'opportunity_applications') return { data: fx.apps, error: null }
      return { data: [], error: null }
    }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'update']) chain[m] = () => chain
    chain.single = () => Promise.resolve(result())
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    return chain
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  }
})
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: { id: 'club-1' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))

import ApplicantsList from '@/pages/ApplicantsList'

function app(i: number, status: ApplicationStatus) {
  return {
    id: `app-${i}`,
    opportunity_id: 'opp-1',
    applicant_id: `player-${i}`,
    status,
    applied_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    metadata: {},
    applicant: {
      id: `player-${i}`,
      full_name: `Player ${status}`,
      avatar_url: null,
      position: 'defender',
      secondary_position: null,
      base_location: 'Buenos Aires',
      nationality: 'Argentina',
      username: `player${i}`,
      role: 'player',
    },
  }
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/opportunities/opp-1/applicants']}>
      <Routes>
        <Route path="/dashboard/opportunities/:opportunityId/applicants" element={<ApplicantsList />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ApplicantsList (desktop v1) — every status renders', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-09T12:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders one card per application for every status, and the header count matches', async () => {
    fx.apps = ALL_STATUSES.map((s, i) => app(i, s))
    renderList()

    expect(await screen.findByText(`${ALL_STATUSES.length} applicants`)).toBeInTheDocument()
    for (const s of ALL_STATUSES) {
      expect(screen.getByText(`Player ${s}`), s).toBeInTheDocument()
    }
    // One card per application: the "View Profile" button appears once per card.
    expect(screen.getAllByRole('button', { name: 'View Profile' })).toHaveLength(ALL_STATUSES.length)
  })

  it('groups the offer / signing road under "Offer & signing" with the phone road tags, read-only', async () => {
    const road: ApplicationStatus[] = ['offered', 'accepted', 'signed_pending_confirmation', 'signed']
    fx.apps = road.map((s, i) => app(i, s))
    renderList()

    const heading = await screen.findByRole('heading', { name: 'Offer & signing' })
    const section = heading.closest('section') as HTMLElement
    expect(within(section).getByText(String(road.length))).toBeInTheDocument()
    for (const s of road) {
      expect(within(section).getByText(`Player ${s}`)).toBeInTheDocument()
      expect(within(section).getByText(clubRoadTag(s) as string)).toBeInTheDocument()
    }
    expect(within(section).getAllByTestId('applicant-card-tag').map((t) => t.textContent)).toEqual([
      'Offer sent',
      'Offer accepted',
      'Waiting to confirm',
      'Signed',
    ])
    // No new desktop actions: no status pill menu on these rows.
    expect(within(section).queryByRole('button', { name: /change status|good fit|unsorted/i })).toBeNull()
    expect(within(section).getAllByRole('button', { name: 'View Profile' })).toHaveLength(road.length)
  })

  it('only the read-only road rows carry a grey tag', async () => {
    fx.apps = [app(1, 'pending'), app(2, 'signed')]
    renderList()
    await screen.findByText('2 applicants')
    expect(screen.getAllByTestId('applicant-card-tag')).toHaveLength(1)
    expect(screen.getByTestId('applicant-card-tag')).toHaveTextContent('Signed')
  })
})
