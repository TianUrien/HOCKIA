/**
 * Integration: the real MemberPreviewSheet with the overlays it opens on top
 * of itself (Sentry JAVASCRIPT-REACT-9B — iOS Community crash). The sheet's
 * BottomSheet trap stays on while the photo lightbox or the guest Join sheet
 * is open; focus must never ping-pong between the two traps.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

const authState = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}))
vi.mock('@/lib/toast', () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({
    isOwnProfile: false,
    isFriend: false,
    isOutgoingRequest: false,
    isIncomingRequest: false,
    mutating: false,
    sendRequest: vi.fn(),
    acceptRequest: vi.fn(),
  }),
}))
vi.mock('@/hooks/useFriendsInCommon', () => ({
  useFriendsInCommon: () => ({ people: [] }),
  inCommonLabel: () => null,
}))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [] }),
  isEuCountryCode: () => false,
}))
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
  trackProtectedActionBlocked: vi.fn(),
  trackSignupWallAction: vi.fn(),
}))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), markWallIntent: vi.fn() }))
vi.mock('@/lib/startConversation', () => ({ resolveConversationRoute: vi.fn() }))

import { MemberPreviewSheet } from '@/components/community/MemberPreviewSheet'
import type { Profile } from '@/components/community/PeopleListView'

const member = {
  id: 'member-1',
  role: 'player',
  full_name: 'Ana Test',
  avatar_url: 'https://example.com/ana.jpg',
  position: 'midfielder',
  base_location: 'Rosario',
} as unknown as Profile

beforeEach(() => {
  // jsdom has no layout; make buttons count as visible for the trap.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSheet(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <MemberPreviewSheet member={member} onClose={onClose} />
    </MemoryRouter>,
  )
  return onClose
}

describe('MemberPreviewSheet nested overlays', () => {
  it('opening the photo over the sheet does not overflow the stack; focus stays in the lightbox', () => {
    const onClose = renderSheet()
    const photo = screen.getByLabelText("Open Ana Test's photo") as HTMLButtonElement
    photo.focus() // a real tap focuses the button before click
    expect(() => fireEvent.click(photo)).not.toThrow()

    const viewer = screen.getByLabelText('Media viewer')
    const close = screen.getByLabelText('Close') as HTMLButtonElement
    expect(viewer.contains(document.activeElement)).toBe(true)
    expect(() => close.focus()).not.toThrow()
    expect(document.activeElement).toBe(close)

    // Focus straying back into the sheet is pulled into the lightbox once.
    expect(() => (screen.getByLabelText('Close preview') as HTMLButtonElement).focus()).not.toThrow()
    expect(viewer.contains(document.activeElement)).toBe(true)

    // Escape closes the lightbox only.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Media viewer')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    // Focus returns to the photo button inside the sheet.
    expect(document.activeElement).toBe(screen.getByLabelText("Open Ana Test's photo"))

    // Next Escape closes the sheet.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("guest: the Join sheet over the preview doesn't fight it for focus; Escape closes only the Join sheet", () => {
    authState.user = null
    const onClose = renderSheet()
    fireEvent.click(screen.getByText('Add friend'))
    const create = screen.getByText('Create a profile')
    expect(document.activeElement?.closest('[aria-label="Join Hockia to add friends"]')).not.toBeNull()

    expect(() => (screen.getByLabelText('Close preview') as HTMLButtonElement).focus()).not.toThrow()
    expect(create.closest('[role="dialog"]')?.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Create a profile')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
