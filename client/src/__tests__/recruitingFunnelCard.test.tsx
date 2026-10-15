import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RecruitingFunnelCard } from '@/features/admin/components/RecruitingFunnelCard'
import { summariseChannels } from '@/features/admin/lib/acquisitionCharts'
import type { RecruitingFunnel } from '@/features/admin/types'

const funnel: RecruitingFunnel = {
  period_days: 30,
  steps: [
    { key: 'posted', label: 'Roles posted', count: 3, people: 2, unit: 'roles', people_unit: 'clubs' },
    { key: 'viewed', label: 'Roles viewed', count: 3, people: 113, unit: 'roles', people_unit: 'viewers' },
    { key: 'applied', label: 'Applications', count: 42, people: 27, unit: 'applications', people_unit: 'applicants' },
    { key: 'shortlisted', label: 'Shortlisted', count: 2, people: 2, unit: 'applications', people_unit: 'players' },
    { key: 'invited', label: 'Invited to apply', count: 2, people: 2, unit: 'invites', people_unit: 'players' },
    { key: 'offered', label: 'Offers sent', count: 0, people: 0, unit: 'offers', people_unit: 'players' },
    { key: 'signed', label: 'Signed', count: 0, people: 0, unit: 'signings', people_unit: 'players' },
  ],
  medians: { role_to_first_application_hours: 30.5, invite_response_hours: null, offer_response_hours: null, roles_with_application: 3, applications_without_reply: 38 },
  generated_at: '2026-10-15T00:00:00Z',
}

vi.mock('@/features/admin/api/adminApi', () => ({
  getRecruitingFunnel: vi.fn(async () => funnel),
  getSignupsByChannelWeek: vi.fn(async () => []),
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

describe('RecruitingFunnelCard', () => {
  it('renders every step with its count, people and the share it is a share of', async () => {
    wrap(<RecruitingFunnelCard days={30} />)
    const list = await screen.findByTestId('recruiting-funnel')
    const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent)
    expect(items).toHaveLength(7)
    expect(items[0]).toMatch(/Roles posted3 roles2 clubs/)
    expect(items[1]).toMatch(/100% of roles posted/)
    expect(items[2]).toMatch(/27 applicants · 24% of viewers applied/) // 27 of 113
    expect(items[3]).toMatch(/5% of applications/) // 2 of 42
    expect(items[6]).toMatch(/Signed0 signings—/) // zero people shows as a dash, never 0%
  })

  it('shows the medians and the unanswered applications', async () => {
    wrap(<RecruitingFunnelCard days={30} />)
    const dl = await screen.findByTestId('funnel-medians')
    expect(dl.textContent).toMatch(/31 h median · 3 roles/)
    expect(dl.textContent).toMatch(/Invite answered in—/)
    expect(dl.textContent).toMatch(/Applications still unanswered38/)
  })
})

describe('summariseChannels', () => {
  it('ranks channels before non-channels, pivots weeks and flags the current week', () => {
    const rows = [
      { week: '2026-10-05', channel_group: 'direct', signups: 9, measured: 0 },
      { week: '2026-10-05', channel_group: 'social', signups: 2, measured: 1 },
      { week: '2026-10-12', channel_group: 'search', signups: 4, measured: 4 },
      { week: '2026-10-12', channel_group: 'direct', signups: 1, measured: 0 },
    ]
    const s = summariseChannels(rows, '2026-10-15')
    expect(s.groups).toEqual(['search', 'social', 'direct']) // direct is biggest but never leads
    expect(s.total).toBe(16)
    expect(s.measured).toBe(5)
    expect(s.weekly).toHaveLength(2)
    expect(s.weekly[0]).toMatchObject({ week: '2026-10-05', social: 2, direct: 9, search: 0, partial: false })
    expect(s.weekly[1]).toMatchObject({ week: '2026-10-12', search: 4, partial: true })
  })
})
