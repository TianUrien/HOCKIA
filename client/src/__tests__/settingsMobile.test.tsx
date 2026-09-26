/**
 * Phone Settings is shared by every role. Player-only rows (availability,
 * "Looking for", date of birth, languages, My
 * applications / New roles) must not show for a club; the full-match setting is
 * players-only (Phase 1 step 3) — a club flipping
 * "Open to opportunities" here used to drive its Recruiting pill.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

type P = { id: string; role: string; full_name: string; date_of_birth: string | null; languages: string[]; avatar_url: null }
let profile: P
const authState = () => ({
  user: { id: profile.id, email: 'x@hockia.test', app_metadata: { provider: 'email' } },
  profile,
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
})

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: ReturnType<typeof authState>) => unknown) => (sel ? sel(authState()) : authState()),
}))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/hooks/usePushSubscription', () => ({
  usePushSubscription: () => ({ isSupported: true, isSubscribed: true, permission: 'granted', loading: false, subscribe: vi.fn(), unsubscribe: vi.fn() }),
}))
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ blockedIds: new Set() }) }))
vi.mock('@/components/BlockedAccountsList', () => ({ default: () => null }))
vi.mock('@/components/DeleteAccountModal', () => ({ default: () => null }))
vi.mock('@/lib/analytics', () => ({ trackPushSubscribe: vi.fn(), trackPushUnsubscribe: vi.fn() }))
vi.mock('@/hooks/useFullMatchPrivacyNotice', () => ({ useFullMatchPrivacyNotice: () => ({ resolveNotice: vi.fn() }) }))

import SettingsMobile, { type SettingsSection } from '@/components/settings/SettingsMobile'

const as = (role: string) => {
  profile = { id: 'u1', role, full_name: 'Someone', date_of_birth: '1995-04-02', languages: ['English', 'Spanish'], avatar_url: null }
}
const renderAt = (section: SettingsSection) => render(<MemoryRouter><SettingsMobile section={section} /></MemoryRouter>)

describe('SettingsMobile · hub', () => {
  beforeEach(() => as('player'))

  it('a player keeps availability, date of birth and languages', () => {
    renderAt('hub')
    expect(screen.getByText('Open to play')).toBeTruthy()
    expect(screen.getByText('Open to opportunities')).toBeTruthy()
    expect(screen.getByText('Looking for')).toBeTruthy()
    expect(screen.getByText('Date of birth')).toBeTruthy()
    expect(screen.getByText('Languages')).toBeTruthy()
    expect(screen.queryByText('Club & league')).toBeNull()
  })

  it('a player’s Open to play row opens the Open to play screen (no inline switch)', () => {
    renderAt('hub')
    expect(screen.queryByRole('switch', { name: 'Open to play' })).toBeNull()
    expect(screen.getByRole('button', { name: /Open to play/ })).toBeTruthy()
  })

  it('a coach keeps availability', () => {
    as('coach')
    renderAt('hub')
    expect(screen.getByText('Open to play')).toBeTruthy()
  })

  it('a club sees none of the player rows, and gets Club & league', () => {
    as('club')
    renderAt('hub')
    for (const t of ['Open to play', 'Open to opportunities', 'Looking for', 'Date of birth', 'Languages', 'Clubs & coaches']) {
      expect(screen.queryByText(t)).toBeNull()
    }
    expect(screen.getByText('Club & league')).toBeTruthy()
    expect(screen.getByText('Email & sign-in')).toBeTruthy()
  })
})

describe('SettingsMobile · notifications and privacy', () => {
  it('a club gets no My applications / New roles', () => {
    as('club')
    renderAt('notifications')
    expect(screen.queryByText('My applications')).toBeNull()
    expect(screen.queryByText('New roles')).toBeNull()
    expect(screen.getByText('Messages')).toBeTruthy()
  })

  it('a player keeps them', () => {
    as('player')
    renderAt('notifications')
    expect(screen.getByText('My applications')).toBeTruthy()
    expect(screen.getByText('New roles')).toBeTruthy()
  })

  it('the full-match setting is for players only (hidden for clubs and coaches)', () => {
    as('club')
    const club = renderAt('privacy')
    expect(screen.queryByText('Who can watch your full matches')).toBeNull()
    expect(screen.getByText('Browse anonymously')).toBeTruthy()
    club.unmount()
    as('coach')
    const coach = renderAt('privacy')
    expect(screen.queryByText('Who can watch your full matches')).toBeNull()
    coach.unmount()
    as('player')
    renderAt('privacy')
    expect(screen.getByText('Who can watch your full matches')).toBeTruthy()
  })
})
