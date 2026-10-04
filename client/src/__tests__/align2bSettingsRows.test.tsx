/**
 * Settings (Figma 45:404 / 254:753 / 254:1000): menu rows with an icon tile,
 * value and chevron; "Sign out" is a menu row; "Delete account" is a small
 * Destructive button, last; Notifications keeps Push | Email and its footer.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

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

const authState = () => ({
  user: { id: 'u1', email: 'x@hockia.test', app_metadata: { provider: 'google' } },
  profile: { id: 'u1', role: 'player', full_name: 'Valentina Turienzo', date_of_birth: '2000-03-12', languages: [], avatar_url: null, full_match_visibility: 'recruiters' },
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
})
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

const renderAt = (section: SettingsSection) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><SettingsMobile section={section} /></MemoryRouter>
  </QueryClientProvider>,
)
const rowOf = (title: string) => screen.getByText(title).closest('button, div.flex') as HTMLElement

describe('Settings · hub rows', () => {
  it('large title with a back to Profile', () => {
    renderAt('hub')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings')
    expect(screen.getByRole('button', { name: 'Back to Profile' })).toBeTruthy()
  })

  it('navigation rows carry an icon tile, a value and a chevron', () => {
    renderAt('hub')
    const notifications = rowOf('Notifications')
    expect(notifications.tagName).toBe('BUTTON')
    expect(notifications.textContent).toContain('Per type')
    expect(notifications.querySelector('.rounded-tile')).not.toBeNull()
    expect(notifications.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    const privacy = rowOf('Privacy')
    expect(privacy.textContent).toContain('Clubs & coaches')
    expect(privacy.querySelector('.rounded-tile')).not.toBeNull()
    expect(rowOf('Language').textContent).toContain('English')
    const account = rowOf('Email & sign-in')
    expect(account.textContent).toContain('Google')
    expect(account.querySelector('svg.lucide-chevron-right')).not.toBeNull()
  })

  it('"Sign out" is a plain menu row', () => {
    renderAt('hub')
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(signOut.className).toContain('min-h-[50px]')
    expect(signOut.className).not.toMatch(/bg-status-danger|text-red/)
  })

  it('"Delete account" is a small Destructive button and comes last', () => {
    renderAt('hub')
    const del = screen.getByTestId('settings-delete-account')
    expect(del.textContent).toBe('Delete account')
    expect(del.className).toContain('bg-status-danger-soft')
    expect(del.className).toContain('text-status-danger')
    expect(del.className).toContain('h-9')
    const buttons = screen.getAllByRole('button')
    expect(buttons[buttons.length - 1]).toBe(del)
  })
})

describe('Settings · notifications and privacy rows', () => {
  it('"Tell me about" keeps Push | Email switches and the footer', () => {
    renderAt('notifications')
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Messages — push' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Messages — email' })).toBeTruthy()
    expect(screen.getByText(/Push and Email move together for now — each type has one setting\./)).toBeTruthy()
  })

  it('privacy: one-switch rows, the full-match radio list and Blocked members "None"', () => {
    renderAt('privacy')
    expect(screen.getByRole('switch', { name: 'Browse anonymously' })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    const blocked = rowOf('Blocked members')
    expect(blocked.textContent).toContain('None')
    expect(blocked.querySelector('svg.lucide-chevron-right')).not.toBeNull()
  })
})
