/**
 * Coach draft (onboarding QA 2026-10-04), now owned by CoachSetupFlow
 * (coach set-up v2, Figma D6.5 / D6.6): CompleteProfile mounts the two-step
 * set-up for a coach who has not finished onboarding; the draft lives under
 * `hockia-onboarding-v2:coach:<uid>`, is restored on reload, and a draft from
 * the 3-step wizard (old key, old shape) is migrated once. The umpire wizard
 * keeps the generic wizard-draft helpers.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coachDraftKey, legacyWizardDraftKey, parseCoachDraft, parseWizardDraft, serializeCoachDraft, serializeWizardDraft, type CoachSetupDraft } from '@/lib/onboardingV2'

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

const fullDraft = (patch: Partial<CoachSetupDraft>): CoachSetupDraft => ({
  fullName: '', dateOfBirth: '', nationalityCountryId: null, nationality2CountryId: null, location: '', baseCity: '', baseCountryId: null,
  locationSelected: false, specialization: '', specializationCustom: '', categories: [], currentClub: '', currentWorldClubId: null,
  recruitsForTeam: null, openToCoach: true, ...patch,
})

describe('coach draft shape', () => {
  it('round-trips the v2 shape and drops stale drafts', () => {
    const now = Date.parse('2026-10-04T10:00:00Z')
    const raw = serializeCoachDraft(fullDraft({ fullName: 'Sam Rivera', recruitsForTeam: false }), now)
    expect(parseCoachDraft(raw, now)).toMatchObject({ fullName: 'Sam Rivera', recruitsForTeam: false })
    expect(parseCoachDraft(raw, Date.parse('2026-10-20T10:00:00Z'))).toBeNull()
    expect(parseCoachDraft('{not json', now)).toBeNull()
  })
})

describe('CompleteProfile coach set-up', () => {
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

  it('mounts the two-step set-up (no 3-step wizard, no gradient stepper)', async () => {
    renderCoach()
    expect(await screen.findByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(screen.queryByText(/Complete Coach Profile/)).not.toBeInTheDocument()
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument()
  })

  it('restores a saved draft on reload', async () => {
    localStorage.setItem(coachDraftKey('u1'), serializeCoachDraft(fullDraft({ fullName: 'Sam Rivera' })))
    renderCoach()
    await waitFor(() => expect(screen.getByDisplayValue('Sam Rivera')).toBeInTheDocument())
  })

  it('a draft under the older key is migrated to the v2 key', async () => {
    localStorage.setItem(legacyWizardDraftKey('coach', 'u1'), serializeWizardDraft(1, { fullName: 'Alex Kim' }))
    renderCoach()
    await waitFor(() => expect(screen.getByDisplayValue('Alex Kim')).toBeInTheDocument())
    expect(localStorage.getItem(legacyWizardDraftKey('coach', 'u1'))).toBeNull()
    await waitFor(() => expect(parseCoachDraft(localStorage.getItem(coachDraftKey('u1')))).toMatchObject({ fullName: 'Alex Kim' }))
  })

  it('typing is persisted under the v2 key', async () => {
    renderCoach()
    const name = await screen.findByLabelText('Full name')
    fireEvent.change(name, { target: { value: 'Jo Park' } })
    await waitFor(() => expect(parseCoachDraft(localStorage.getItem(coachDraftKey('u1')))).toMatchObject({ fullName: 'Jo Park' }))
  })
})
