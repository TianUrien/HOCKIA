/**
 * Club set-up (Figma 04 Club D1.24): CompleteProfile's gate. Phone clubs that
 * have not onboarded get the set-up; onboarded clubs never; desktop clubs and
 * players keep today's onboarding.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], getCountryById: () => undefined }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { refreshSession: vi.fn() }, storage: { from: vi.fn() } } }))
const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(auth.state) : auth.state),
    { getState: () => auth.state },
  ),
}))
vi.mock('@/components/ClubClaimStep', () => ({ default: () => <div data-testid="classic-club-claim" /> }))
const newClub = { id: 'u1', role: 'club', full_name: 'Kilkenny Hockey Club', avatar_url: null, onboarding_completed: false, org_attested_18plus_at: null }

const media = vi.hoisted(() => ({ phone: true }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => media.phone }))
vi.mock('@/components/club/ClubSetupFlow', () => ({
  default: ({ onFinished }: { onFinished: () => void }) => <button type="button" data-testid="club-setup-stub" onClick={onFinished}>setup</button>,
}))
vi.mock('@/lib/analytics', () => ({ trackOnboardingComplete: vi.fn(), trackOnboardingStart: vi.fn(), trackRoleSelected: vi.fn() }))
vi.mock('@/lib/attribution', () => ({ getAttributionState: () => null, submitSignupAttribution: vi.fn() }))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn(() => Promise.resolve()) }))

describe('CompleteProfile routes phone clubs to the set-up', () => {
  let CompleteProfile: typeof import('@/pages/CompleteProfile').default
  beforeEach(async () => {
    vi.clearAllMocks()
    media.phone = true
    CompleteProfile = (await import('@/pages/CompleteProfile')).default
    navigateMock.mockClear()
  })
  const renderAs = (profile: Record<string, unknown>) => {
    const setProfile = vi.fn()
    auth.state = { user: { id: 'u1', email: 'x@example.com', user_metadata: {} }, profile, loading: false, profileStatus: 'loaded', fetchProfile: vi.fn(), setProfile }
    render(<MemoryRouter initialEntries={['/complete-profile']}><CompleteProfile /></MemoryRouter>)
    return setProfile
  }

  it('a phone club that has not onboarded gets the set-up; finishing lands on Opportunities', async () => {
    const setProfile = renderAs({ ...newClub })
    fireEvent.click(await screen.findByTestId('club-setup-stub'))
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ onboarding_completed: true }))
    expect(navigateMock).toHaveBeenCalledWith('/opportunities', { replace: true })
  })

  it('an already-onboarded club is never routed to the set-up', async () => {
    renderAs({ ...newClub, onboarding_completed: true })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard/profile', { replace: true }))
    expect(screen.queryByTestId('club-setup-stub')).toBeNull()
  })

  it('a desktop club keeps the classic form', async () => {
    media.phone = false
    renderAs({ ...newClub })
    expect(await screen.findByTestId('classic-club-claim')).toBeTruthy()
    expect(screen.queryByTestId('club-setup-stub')).toBeNull()
  })

  it('a phone player keeps the player onboarding', async () => {
    renderAs({ id: 'u1', role: 'player', full_name: null, onboarding_completed: false })
    await waitFor(() => expect(screen.queryByTestId('club-setup-stub')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'About your club' })).toBeNull()
  })
})

// ── Link your club, onboarding mode (step 2) ────────────────────────

vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))

describe('LinkClubScreen onboarding mode', () => {
  it('"‹ Back", "Step 2 of 2" and Skip for now; the default mode keeps Cancel', async () => {
    const LinkClubScreen = (await import('@/components/profile/mobile/LinkClubScreen')).default
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const profile = { id: 'u1', role: 'club', full_name: '', nationality_country_id: null } as never
    const { unmount } = render(<LinkClubScreen profile={profile} mode="onboarding" onCancel={onCancel} onLinked={vi.fn()} onSkip={onSkip} />)
    expect(screen.getByText(/^Step 2 of 2 · Linking puts your league/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to About your club' }))
    expect(onCancel).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onSkip).toHaveBeenCalled()
    unmount()
    render(<LinkClubScreen profile={profile} onCancel={vi.fn()} onLinked={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.queryByText(/Step 2 of 2/)).toBeNull()
  })
})
