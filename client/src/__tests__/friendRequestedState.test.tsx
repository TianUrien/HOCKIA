/**
 * Pending OUTBOUND friend request = grey "Requested" with a check, everywhere
 * (founder ruling 2026-09-25). The phone surfaces already did this; these lock
 * the desktop/v1 controls (FriendshipButton, QuickActionsRow,
 * RecruiterCardActions) to the same label + icon — never a clock, never
 * "Request sent" / "Pending".
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ profile: { id: 'viewer-1', role: 'club' } }),
}))

vi.mock('@/hooks/useSavedProfiles', () => ({
  useIsProfileSaved: () => ({
    isSaved: false,
    mutating: false,
    isAuthenticated: true,
    isOwnProfile: false,
    toggle: vi.fn(() => Promise.resolve()),
  }),
}))

// Outbound request pending.
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({
    loading: false,
    mutating: false,
    isAuthenticated: true,
    isOwnProfile: false,
    isFriend: false,
    isIncomingRequest: false,
    isOutgoingRequest: true,
    status: 'pending',
    sendRequest: vi.fn(),
    acceptRequest: vi.fn(),
    rejectRequest: vi.fn(),
    cancelRequest: vi.fn(),
    removeFriend: vi.fn(),
  }),
}))

vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/components/recruiting/MoreActionsMenu', () => ({ default: () => null }))

import FriendshipButton from '@/components/FriendshipButton'
import QuickActionsRow from '@/components/recruiting/QuickActionsRow'
import RecruiterCardActions from '@/components/recruiting/RecruiterCardActions'

function expectRequestedWithCheck(button: HTMLElement) {
  expect(button.querySelector('svg.lucide-check')).not.toBeNull()
  expect(button.querySelector('svg.lucide-clock')).toBeNull()
  expect(button.textContent ?? '').not.toMatch(/request sent|pending/i)
}

describe('outgoing friend request → grey "Requested" + check', () => {
  it('FriendshipButton (desktop profile header)', () => {
    render(<FriendshipButton profileId="p-1" />)
    const button = screen.getByRole('button', { name: /requested/i })
    expectRequestedWithCheck(button)
    expect(button.className).toMatch(/text-gray-600/)
    expect(button.className).not.toMatch(/amber|rose|red/)
  })

  it('QuickActionsRow (compact recruiter tiles)', () => {
    render(
      <MemoryRouter>
        <QuickActionsRow playerId="p-1" playerName="Jordan Hall" />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: /friend request sent to jordan hall/i })
    expect(button).toHaveTextContent('Requested')
    expect(button).toBeDisabled()
    expectRequestedWithCheck(button)
  })

  it('RecruiterCardActions (candidate card footer)', () => {
    render(
      <MemoryRouter>
        <RecruiterCardActions playerId="p-1" playerName="Jordan Hall" />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: /friend request sent to jordan hall/i })
    expect(button).toHaveTextContent('Requested')
    expect(button).toBeDisabled()
    expectRequestedWithCheck(button)
  })
})
