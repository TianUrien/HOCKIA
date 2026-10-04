/**
 * Onboarding QA 2026-10-04, coach wizard (CompleteProfile coach branch):
 *  - the Back button on steps 2–3 is a proper Secondary button (it used to
 *    carry the legacy btn-primary gradient under white-outline classes: dark
 *    text on purple);
 *  - the coach form is kept as a draft under `hockia-onboarding-v2:coach:<uid>`
 *    (same pattern as the player's), restored on reload, cleared on completion.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coachDraftKey, legacyWizardDraftKey, parseWizardDraft, serializeWizardDraft } from '@/lib/onboardingV2'

describe('wizard draft helpers', () => {
  it('coach key follows the player v2 pattern', () => {
    expect(coachDraftKey('u1')).toBe('hockia-onboarding-v2:coach:u1')
    expect(legacyWizardDraftKey('coach', 'u1')).toBe('hockia-onboarding-draft:coach:u1')
  })
  it('round-trips step and form data', () => {
    const now = Date.parse('2026-10-04T10:00:00Z')
    const raw = serializeWizardDraft(2, { fullName: 'Sam Rivera' }, now)
    expect(parseWizardDraft(raw, now)).toEqual({ step: 2, formData: { fullName: 'Sam Rivera' } })
  })
  it('drops stale, unreadable or empty drafts', () => {
    const now = Date.parse('2026-10-20T10:00:00Z')
    expect(parseWizardDraft(serializeWizardDraft(2, { a: 1 }, Date.parse('2026-10-04T10:00:00Z')), now)).toBeNull()
    expect(parseWizardDraft('{not json', now)).toBeNull()
    expect(parseWizardDraft(null, now)).toBeNull()
    expect(parseWizardDraft(JSON.stringify({ step: 9, formData: [] }), now)).toEqual({ step: null, formData: null })
  })
})

// ── CompleteProfile, coach branch ───────────────────────────────────

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], getCountryById: () => undefined, loading: false }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { refreshSession: vi.fn() }, storage: { from: vi.fn() } } }))
const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(auth.state) : auth.state),
    { getState: () => auth.state },
  ),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/lib/analytics', () => ({ trackOnboardingComplete: vi.fn(), trackOnboardingStart: vi.fn(), trackRoleSelected: vi.fn() }))
vi.mock('@/lib/attribution', () => ({ getAttributionState: () => null, submitSignupAttribution: vi.fn() }))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn(() => Promise.resolve()) }))

const newCoach = { id: 'u1', role: 'coach', full_name: '', avatar_url: null, onboarding_completed: false, date_of_birth: null, bio: null }

describe('CompleteProfile coach wizard', () => {
  let CompleteProfile: typeof import('@/pages/CompleteProfile').default
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    CompleteProfile = (await import('@/pages/CompleteProfile')).default
  })
  const renderCoach = (profile: Record<string, unknown> = newCoach) => {
    auth.state = { user: { id: 'u1', email: 'x@example.com', user_metadata: {} }, profile, loading: false, profileStatus: 'loaded', fetchProfile: vi.fn(), setProfile: vi.fn() }
    return render(<MemoryRouter initialEntries={['/complete-profile']}><CompleteProfile /></MemoryRouter>)
  }

  it('restores a saved draft (step + fields) on reload, and the Back button is Secondary', async () => {
    localStorage.setItem(coachDraftKey('u1'), serializeWizardDraft(2, { fullName: 'Sam Rivera' }))
    renderCoach()
    const back = await screen.findByRole('button', { name: 'Back' })
    expect(back.className).not.toMatch(/btn-primary|gradient/)
    expect(back.className).toMatch(/bg-white/)
    expect(back.className).toMatch(/text-ink-1/)
    fireEvent.click(back)
    await waitFor(() => expect(screen.getByDisplayValue('Sam Rivera')).toBeInTheDocument())
  })

  it('a draft under the older key is migrated to the v2 key', async () => {
    localStorage.setItem(legacyWizardDraftKey('coach', 'u1'), serializeWizardDraft(1, { fullName: 'Alex Kim' }))
    renderCoach()
    await waitFor(() => expect(screen.getByDisplayValue('Alex Kim')).toBeInTheDocument())
    expect(localStorage.getItem(legacyWizardDraftKey('coach', 'u1'))).toBeNull()
    await waitFor(() => expect(parseWizardDraft(localStorage.getItem(coachDraftKey('u1')))?.formData).toMatchObject({ fullName: 'Alex Kim' }))
  })

  it('typing is persisted under the v2 key', async () => {
    renderCoach()
    const name = await screen.findByPlaceholderText(/name/i)
    fireEvent.change(name, { target: { value: 'Jo Park' } })
    await waitFor(() => expect(parseWizardDraft(localStorage.getItem(coachDraftKey('u1')))?.formData).toMatchObject({ fullName: 'Jo Park' }))
  })
})
