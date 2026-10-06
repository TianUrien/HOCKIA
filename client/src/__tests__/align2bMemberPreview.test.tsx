/**
 * Member preview (Figma 72:316 / 115:904): Primary "Add friend" with
 * user-plus + Secondary "Message"; once the request is out the first button
 * is a disabled Secondary "Requested". Facts are Detail rows.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    functions: { invoke: vi.fn() },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

const friendship = vi.hoisted(() => ({
  value: { isOwnProfile: false, isFriend: false, isOutgoingRequest: false, isIncomingRequest: false, mutating: false, sendRequest: vi.fn(), acceptRequest: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } }) => unknown) => { const s = { user: { id: 'viewer-1' } }; return selector ? selector(s) : s },
}))
vi.mock('@/lib/toast', () => ({ useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }) }))
vi.mock('@/hooks/useFriendship', () => ({ useFriendship: () => friendship.value }))
vi.mock('@/hooks/useFriendsInCommon', () => ({
  useFriendsInCommon: () => ({ people: [{ id: 'a' }] }),
  inCommonLabel: () => 'Lucía Ferreiro',
}))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [{ id: 1, code: 'AR', name: 'Argentina', flag_emoji: '🇦🇷' }, { id: 2, code: 'ES', name: 'Spain', flag_emoji: '🇪🇸' }] }),
  isEuCountryCode: (code: string) => code === 'ES',
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackProtectedActionBlocked: vi.fn(), trackSignupWallAction: vi.fn() }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), markWallIntent: vi.fn() }))
vi.mock('@/lib/startConversation', () => ({ resolveConversationRoute: vi.fn() }))

import { MemberPreviewSheet } from '@/components/community/MemberPreviewSheet'
import type { Profile } from '@/components/community/PeopleListView'

const member = {
  id: 'member-1', role: 'player', full_name: 'Florencia', avatar_url: null, position: 'defender', secondary_position: 'midfielder',
  base_location: 'Bremen, Germany', current_club: 'Bremer HC', nationality_country_id: 1, nationality2_country_id: 2,
} as unknown as Profile

const renderSheet = () => render(<MemoryRouter><MemberPreviewSheet member={member} onClose={vi.fn()} /></MemoryRouter>)
const reset = () => { friendship.value = { ...friendship.value, isFriend: false, isOutgoingRequest: false, isIncomingRequest: false } }

afterEach(() => { cleanup(); reset() })

describe('MemberPreviewSheet · buttons', () => {
  it('Primary "Add friend" with user-plus and Secondary "Message"', () => {
    renderSheet()
    const add = screen.getByTestId('member-preview-friend')
    expect(add.textContent).toContain('Add friend')
    expect(add.className).toContain('bg-hockia-primary')
    expect(add.querySelector('svg.lucide-user-plus')).not.toBeNull()
    expect((add as HTMLButtonElement).disabled).toBe(false)
    const message = screen.getByTestId('member-preview-message')
    expect(message.textContent).toContain('Message')
    expect(message.className).toContain('ring-line')
    expect(message.className).not.toContain('bg-hockia-primary')
  })

  it('request sent = disabled Secondary "Requested"; still one Message', () => {
    friendship.value = { ...friendship.value, isOutgoingRequest: true }
    renderSheet()
    const requested = screen.getByTestId('member-preview-friend') as HTMLButtonElement
    expect(requested.textContent).toContain('Requested')
    expect(requested.disabled).toBe(true)
    expect(requested.className).toContain('ring-line')
    expect(requested.className).not.toContain('bg-hockia-primary')
    expect(screen.queryByText('Add friend')).toBeNull()
    expect(screen.getByTestId('member-preview-message')).toBeTruthy()
  })

  it('an incoming request reads "Accept" on the Primary', () => {
    friendship.value = { ...friendship.value, isIncomingRequest: true }
    renderSheet()
    expect(screen.getByTestId('member-preview-friend').textContent).toContain('Accept')
  })

  it('there is one Primary in the sheet', () => {
    renderSheet()
    expect(screen.getByRole('dialog').querySelectorAll('button.bg-hockia-primary')).toHaveLength(1)
  })

  it('facts are Detail rows with a secondary second line; "See full profile" is a link', () => {
    renderSheet()
    const rows = screen.getByTestId('member-preview-rows')
    const labels = Array.from(rows.querySelectorAll('[data-testid="detail-row-item"]')).map((r) => r.firstElementChild?.textContent)
    expect(labels).toEqual(['Passports', 'Club', 'Based', 'In common'])
    expect(screen.getByTestId('detail-row-sub').textContent).toBe('EU passport')
    const link = screen.getByTestId('member-preview-full-profile')
    expect(link.textContent).toBe('See full profile')
    expect(link.className).toContain('text-hockia-primary')
  })

  it('never shows a fit, score or level to the viewer', () => {
    renderSheet()
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/fit|score|level|%/i)
  })
})
