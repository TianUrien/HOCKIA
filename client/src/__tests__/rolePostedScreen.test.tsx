import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import RolePostedScreen from '@/components/club/RolePostedScreen'

// Role posted (Figma 04 Club D1.26 368:780; DEV NOTE 368:1098).
let expiryDays: number | null = 21
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: expiryDays === null ? null : { expiry_days: expiryDays }, error: null }) }) }),
    }),
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ trackPushSubscribe: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { full_name: 'Kilkenny HC', avatar_url: null, role: 'club' } }),
}))
const push = { isSupported: true, isSubscribed: false, permission: 'default' as NotificationPermission, loading: false, subscribe: vi.fn(async () => {}) }
vi.mock('@/hooks/usePushSubscription', () => ({ usePushSubscription: () => push }))

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}|{JSON.stringify(loc.state)}</p>
}

const renderAt = (draft: { type: 'player' | 'coach'; position: 'midfielder' | 'head_coach' }) =>
  render(
    <MemoryRouter initialEntries={['/dashboard/opportunities/new']}>
      <Routes>
        <Route path="/dashboard/opportunities/new" element={<RolePostedScreen roleId="r1" draft={draft} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  expiryDays = 21
  push.isSubscribed = false
  push.permission = 'default'
  localStorage.clear()
})

describe('RolePostedScreen', () => {
  it('shows "<position> is live", the configured reply window and Find players', async () => {
    renderAt({ type: 'player', position: 'midfielder' })
    expect(screen.getByRole('heading', { name: 'Midfielder is live' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('role-posted-reply-window')).toHaveTextContent('within 21 days'))
    expect(screen.getByRole('button', { name: 'Find players for this role' })).toBeInTheDocument()
  })

  it('coach roles find coaches', async () => {
    const user = userEvent.setup()
    renderAt({ type: 'coach', position: 'head_coach' })
    expect(screen.getByRole('heading', { name: 'Head coach is live' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Find coaches for this role' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/community/coaches')
  })

  it('Done and × go to Opportunities with the new role highlighted', async () => {
    const user = userEvent.setup()
    renderAt({ type: 'player', position: 'midfielder' })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/opportunities|{"highlight":"r1"}')
  })

  it('offers push only without a subscription, and stops after two dismissals', async () => {
    const user = userEvent.setup()
    const first = renderAt({ type: 'player', position: 'midfielder' })
    expect(screen.getByTestId('role-posted-push')).toHaveTextContent('Know when players apply')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    first.unmount()
    const second = renderAt({ type: 'player', position: 'midfielder' })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    second.unmount()
    renderAt({ type: 'player', position: 'midfielder' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
  })

  it('hides push once subscribed or granted', () => {
    push.isSubscribed = true
    const a = renderAt({ type: 'player', position: 'midfielder' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
    a.unmount()
    push.isSubscribed = false
    push.permission = 'granted'
    renderAt({ type: 'player', position: 'midfielder' })
    expect(screen.queryByTestId('role-posted-push')).toBeNull()
  })
})
