import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Admin "Ecosystem reach" (founder 2026-11-10): members by country against
// the clubs known in the world directory, and traffic split by relevance.

type Rpc = { fn: string; args: Record<string, unknown> | undefined }
let rpcCalls: Rpc[] = []
let doc: unknown = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'admin_get_ecosystem_reach') return Promise.resolve({ data: doc, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { AdminEcosystemReach } from '@/features/admin/pages/AdminEcosystemReach'
import { getEcosystemReach } from '@/features/admin/api/adminApi'

const sample = {
  window_days: 28, window_start: '2026-10-13T00:00:00Z', window_end: '2026-11-10T00:00:00Z',
  countries: [
    { country_code: 'AR', country_name: 'Argentina', flag_emoji: '🇦🇷', players: '108', coaches: 26, club_accounts: 1, umpires: 0, brands: 0, members: 135, active_30d: 49, known_clubs: 46, claimed_clubs: 1, leagues_known: 3 },
    { country_code: 'DE', country_name: 'Germany', flag_emoji: '🇩🇪', players: 0, coaches: 2, club_accounts: 0, umpires: 0, brands: 0, members: 2, active_30d: 1, known_clubs: 44, claimed_clubs: 0, leagues_known: 2 },
  ],
  totals: { members: 389, members_no_country: 68, players: 279, coaches: 67, club_accounts: 33, umpires: 0, brands: 11, active_30d: 159, countries_with_members: 30, known_clubs: 338, claimed_clubs: 21, countries_in_directory: 28 },
  traffic: { member: 1905, visitor_hockey_intent: 416, unclear: 444, not_relevant: 128 },
  weekly: [{ week: '2026-11-03', member: 400, visitor_hockey_intent: 90, unclear: 100, not_relevant: 30 }],
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><AdminEcosystemReach /></MemoryRouter></QueryClientProvider>)
}

describe('getEcosystemReach', () => {
  beforeEach(() => { rpcCalls = []; doc = sample })

  it('calls the admin RPC with the window and turns every count into a number', async () => {
    const r = await getEcosystemReach(90)
    expect(rpcCalls[0]).toEqual({ fn: 'admin_get_ecosystem_reach', args: { p_days: 90 } })
    expect(r.countries[0].players).toBe(108)
    expect(r.traffic.visitor_hockey_intent).toBe(416)
    expect(r.weekly[0]).toMatchObject({ week: '2026-11-03', member: 400 })
  })

  it('survives an empty response', async () => {
    doc = null
    const r = await getEcosystemReach()
    expect(r.countries).toEqual([])
    expect(r.traffic).toEqual({ member: 0, visitor_hockey_intent: 0, unclear: 0, not_relevant: 0 })
  })
})

describe('AdminEcosystemReach', () => {
  beforeEach(() => { rpcCalls = []; doc = sample })

  it('shows reach by country with role counts, clubs known and the claimed share', async () => {
    renderPage()
    const table = await screen.findByTestId('ecosystem-country-table')
    const ar = (await within(table).findByText(/Argentina/)).closest('tr') as HTMLElement
    expect(within(ar).getByText('108')).toBeInTheDocument()
    expect(within(ar).getByText('46')).toBeInTheDocument()
    expect(within(ar).getByText('(2%)')).toBeInTheDocument()
    const de = within(table).getByText(/Germany/).closest('tr') as HTMLElement
    expect(within(de).getByText('(0%)')).toBeInTheDocument()
    expect(screen.getByText(/68 members have no country yet/)).toBeInTheDocument()
  })

  it('counts relevant sessions as members plus visitors with field hockey intent', async () => {
    renderPage()
    expect(await screen.findByText('2,321')).toBeInTheDocument()
    expect(screen.getByText(/of 2893 sessions/)).toBeInTheDocument()
  })
})
