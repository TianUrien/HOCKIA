import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import RolePostedScreen from '@/components/club/RolePostedScreen'

// Role posted (Figma 04 Club D1.26 368:780; DEV NOTE 368:1098).
let expiryDays: number | null = 21
type Row = { id: string; club_id: string; status: string; opportunity_type: string; position: string; title?: string; gender?: string | null; location_city?: string | null }
let rows: Record<string, Row> = {}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => table === 'opportunities'
      ? { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: () => Promise.resolve({ data: rows[id] ?? null, error: null }) }) }) }
      : { select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: expiryDays === null ? null : { expiry_days: expiryDays }, error: null }) }) }) },
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ trackPushSubscribe: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'club-1', full_name: 'Kilkenny HC', avatar_url: null, role: 'club' } }),
}))
const push = { isSupported: true, isSubscribed: false, permission: 'default' as NotificationPermission, loading: false, subscribe: vi.fn(async () => {}) }
vi.mock('@/hooks/usePushSubscription', () => ({ usePushSubscription: () => push }))
// The recruiting store: records each activation and the path at that moment,
// so a test can prove the role's scope is set BEFORE navigating away.
const calls: string[] = []
let activatePath = ''
const activateForOpportunity = vi.fn(async (input: { opportunityId: string }) => {
  calls.push(`activate:${input.opportunityId}@${activatePath}`)
  return null
})
vi.mock('@/hooks/useRecruitingContext', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useRecruitingContext')>()),
  useRecruitingContext: () => ({ activateForOpportunity }),
}))
const invalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}))

function Where() {
  const loc = useLocation()
  calls.push(`at:${loc.pathname}${loc.search}`)
  return <p data-testid="where">{loc.pathname}|{JSON.stringify(loc.state)}</p>
}

const roleRow = (over: Partial<Row> = {}): Row => ({ id: 'r1', club_id: 'club-1', status: 'open', opportunity_type: 'player', position: 'midfielder', title: 'Role r1', gender: 'Men', location_city: 'Dublin', ...over })

/** Renders /dashboard/opportunities/:id/posted as after a hard reload (no router state). */
const renderAt = (draft: { type: 'player' | 'coach'; position: 'midfielder' | 'head_coach' }, id = 'r1', over: Partial<Row> = {}) => {
  rows = { ...rows, r1: roleRow({ opportunity_type: draft.type, position: draft.position, ...over }) }
  return render(
    <MemoryRouter initialEntries={[`/dashboard/opportunities/${id}/posted`]}>
      <Routes>
        <Route path="/dashboard/opportunities/:id/posted" element={<RolePostedScreen roleId={id} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  rows = {}
  calls.length = 0
  activatePath = 'posted'
  activateForOpportunity.mockClear()
  invalidateQueries.mockClear()
  expiryDays = 21
  push.isSubscribed = false
  push.permission = 'default'
  localStorage.clear()
})

describe('RolePostedScreen', () => {
  it('shows "<position> is live", the configured reply window and Find players', async () => {
    renderAt({ type: 'player', position: 'midfielder' })
    expect(await screen.findByRole('heading', { name: 'Midfielder is live' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('role-posted-reply-window')).toHaveTextContent('within 21 days'))
    expect(screen.getByRole('button', { name: 'Find players for this role' })).toBeInTheDocument()
  })

  it('coach roles find coaches, scoped to THIS role before leaving', async () => {
    const user = userEvent.setup()
    renderAt({ type: 'coach', position: 'head_coach' }, 'r1', { title: 'Coach Test 5', gender: 'Boys' })
    expect(await screen.findByRole('heading', { name: 'Head coach is live' })).toBeInTheDocument()
    const find = screen.getByRole('button', { name: 'Find coaches for this role' })
    await waitFor(() => expect(find).toBeEnabled())
    await user.click(find)
    expect(await screen.findByTestId('where')).toHaveTextContent('/community/coaches')
    // A coach role's team is not a player category → target null.
    expect(activateForOpportunity).toHaveBeenCalledWith({ opportunityId: 'r1', target: null, region: 'Dublin', label: 'Coach Test 5' })
    expect(calls[0]).toBe('activate:r1@posted')
    expect(calls[1]).toBe('at:/community/coaches')
  })

  it('player roles open Find players for this role, scoped before leaving', async () => {
    const user = userEvent.setup()
    renderAt({ type: 'player', position: 'midfielder' }, 'r1', { gender: 'Girls', location_city: null })
    const find = await screen.findByRole('button', { name: 'Find players for this role' })
    await waitFor(() => expect(find).toBeEnabled())
    await user.click(find)
    expect(await screen.findByTestId('where')).toHaveTextContent('/dashboard/find-players')
    expect(activateForOpportunity).toHaveBeenCalledWith({ opportunityId: 'r1', target: 'Women', region: null, label: 'Role r1' })
    expect(calls).toEqual(['activate:r1@posted', 'at:/dashboard/find-players?role=r1'])
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['scouting', 'open-roles'] })
  })

  it('Done and × go to Opportunities with the new role highlighted', async () => {
    const user = userEvent.setup()
    renderAt({ type: 'player', position: 'midfielder' })
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/opportunities|{"highlight":"r1"}')
  })

  it('offers push only without a subscription, and stops after two dismissals', async () => {
    const user = userEvent.setup()
    const first = renderAt({ type: 'player', position: 'midfielder' })
    expect(await screen.findByTestId('role-posted-push')).toHaveTextContent('Know when players apply')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    first.unmount()
    const second = renderAt({ type: 'player', position: 'midfielder' })
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    second.unmount()
    renderAt({ type: 'player', position: 'midfielder' })
    await screen.findByRole('heading', { name: 'Midfielder is live' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
  })

  it('hides push once subscribed or granted', async () => {
    push.isSubscribed = true
    const a = renderAt({ type: 'player', position: 'midfielder' })
    await screen.findByRole('heading', { name: 'Midfielder is live' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
    a.unmount()
    push.isSubscribed = false
    push.permission = 'granted'
    renderAt({ type: 'player', position: 'midfielder' })
    await screen.findByRole('heading', { name: 'Midfielder is live' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
  })

  it('a missing or someone else\'s role goes to plain Opportunities', async () => {
    renderAt({ type: 'player', position: 'midfielder' }, 'nope')
    expect(await screen.findByTestId('where')).toHaveTextContent('/opportunities|null')
  })

  it('another club\'s role is never shown', async () => {
    rows = { other: roleRow({ id: 'other', club_id: 'club-2' }) }
    render(
      <MemoryRouter initialEntries={['/dashboard/opportunities/other/posted']}>
        <Routes>
          <Route path="/dashboard/opportunities/:id/posted" element={<RolePostedScreen roleId="other" />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('where')).toHaveTextContent('/opportunities|null')
  })

  it('the club\'s own role that is no longer open → Opportunities, highlighted', async () => {
    rows = { r2: roleRow({ id: 'r2', status: 'closed' }) }
    render(
      <MemoryRouter initialEntries={['/dashboard/opportunities/r2/posted']}>
        <Routes>
          <Route path="/dashboard/opportunities/:id/posted" element={<RolePostedScreen roleId="r2" />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('where')).toHaveTextContent('/opportunities|{"highlight":"r2"}')
  })
})
