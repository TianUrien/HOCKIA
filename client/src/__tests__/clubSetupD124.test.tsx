/**
 * Club set-up — the club part of onboarding (Figma 04 Club D1.24, DEV NOTE
 * 368:1088). Routing rules first, then the flow with its data mocked, then
 * CompleteProfile's gate (phone clubs only; onboarded clubs never; players
 * and desktop unchanged).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clubSetupReady, showsClubSetup, type ClubSetupDraft } from '@/lib/clubSetup'

describe('who gets the club set-up', () => {
  it('phone clubs that have not finished onboarding only', () => {
    expect(showsClubSetup('club', true, false)).toBe(true)
    expect(showsClubSetup('club', true, null)).toBe(true)
    expect(showsClubSetup('club', true, true)).toBe(false)
    expect(showsClubSetup('club', false, false)).toBe(false)
    for (const role of ['player', 'coach', 'umpire', 'brand', null]) expect(showsClubSetup(role, true, false)).toBe(false)
  })
  it('Continue needs name, country, city and the 18+ box; year is optional', () => {
    const d: ClubSetupDraft = { name: 'Kilkenny HC', countryId: 104, location: 'Kilkenny, Ireland', city: 'Kilkenny', baseCountryId: 104, locationSelected: true, yearFounded: '', attested: true }
    expect(clubSetupReady(d)).toBe(true)
    expect(clubSetupReady({ ...d, name: '  ' })).toBe(false)
    expect(clubSetupReady({ ...d, countryId: null })).toBe(false)
    expect(clubSetupReady({ ...d, location: '' })).toBe(false)
    expect(clubSetupReady({ ...d, attested: false })).toBe(false)
  })
})

// ── Flow ────────────────────────────────────────────────────────────

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})
const toast = vi.hoisted(() => ({ addToast: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: typeof toast) => unknown) => sel(toast) }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: [{ id: 104, name: 'Ireland', common_name: null, nationality_name: 'Irish', flag_emoji: '🇮🇪' }],
    getCountryById: (id: number) => (id === 104 ? { id: 104, name: 'Ireland', common_name: null, nationality_name: 'Irish', flag_emoji: '🇮🇪' } : undefined),
  }),
}))

const db = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  exists: true,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { refreshSession: () => Promise.resolve({ error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: db.exists ? { id: 'u1' } : null, error: null }) }) }),
      update: (patch: Record<string, unknown>) => { db.updates.push(patch); return { eq: () => Promise.resolve({ error: null }) } },
    }),
    rpc: (...args: unknown[]) => db.rpc(...args),
    storage: { from: vi.fn() },
  },
}))

// Link your club is its own tested screen; here we only need its onboarding contract.
const link = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@/components/profile/mobile/LinkClubScreen', () => ({
  default: (props: { mode?: string; onCancel: () => void; onSkip?: () => void; onLinked: () => void }) => {
    link.props = props as unknown as Record<string, unknown>
    return (
      <div data-testid="link-club-stub">
        <span>mode:{props.mode}</span>
        <button type="button" onClick={props.onCancel}>Back</button>
        <button type="button" onClick={props.onSkip}>Skip for now</button>
        <button type="button" onClick={props.onLinked}>Linked</button>
      </div>
    )
  },
}))

const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(auth.state) : auth.state),
    { getState: () => auth.state },
  ),
}))

import ClubSetupFlow from '@/components/club/ClubSetupFlow'

const newClub = {
  id: 'u1', role: 'club', full_name: 'Kilkenny Hockey Club', avatar_url: null, nationality_country_id: 104,
  base_location: 'Kilkenny, Ireland', base_city: 'Kilkenny', base_country_id: 104, year_founded: null,
  onboarding_completed: false, org_attested_18plus_at: null,
}

describe('ClubSetupFlow (D1.24)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.updates = []
    db.exists = true
    db.rpc.mockResolvedValue({ data: { outcome: 'attested' }, error: null })
    link.props = null
    auth.state = { user: { id: 'u1', email: 'club@example.com' }, profile: { ...newClub }, fetchProfile: vi.fn().mockResolvedValue(undefined) }
  })

  it('step 1 is About your club: no back button, Continue waits for the 18+ box', () => {
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'About your club' })).toBeTruthy()
    expect(screen.getByText('Step 1 of 2 · what players see next to every role.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add your crest' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull()
    expect(screen.queryByText(/contact email/i)).toBeNull()
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(cont.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /18 or over/ }))
    expect(cont.disabled).toBe(false)
  })

  it('Continue saves the basics, calls the attestation, then shows Link your club in onboarding mode', async () => {
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Year founded · optional'), { target: { value: '1955' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /18 or over/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('link-club-stub')
    expect(db.updates[0]).toEqual({
      role: 'club', full_name: 'Kilkenny Hockey Club', nationality_country_id: 104, nationality: 'Ireland',
      base_location: 'Kilkenny, Ireland', base_city: 'Kilkenny', base_country_id: 104, year_founded: 1955, open_to_opportunities: true,
    })
    expect(db.rpc).toHaveBeenCalledWith('attest_org_operator_adult')
    // The set-up step never finishes onboarding by itself.
    expect(db.updates.some((u) => 'onboarding_completed' in u)).toBe(false)
    expect(screen.getByText('mode:onboarding')).toBeTruthy()
  })

  it('a refused attestation keeps the club on step 1 with an error', async () => {
    db.rpc.mockResolvedValue({ data: { outcome: 'not_an_org_role' }, error: null })
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /18 or over/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save your club. Please try again.')
    expect(screen.queryByTestId('link-club-stub')).toBeNull()
  })

  it('a missing profile row is created first (same safety net as CompleteProfile)', async () => {
    db.exists = false
    db.rpc.mockImplementation((name: string) => Promise.resolve(name === 'attest_org_operator_adult' ? { data: { outcome: 'attested' }, error: null } : { data: { id: 'u1' }, error: null }))
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /18 or over/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('link-club-stub')
    expect(db.rpc).toHaveBeenCalledWith('create_profile_for_new_user', { user_id: 'u1', user_email: 'club@example.com', user_role: 'club' })
  })

  const toStep2 = async (onFinished = vi.fn()) => {
    render(<ClubSetupFlow onFinished={onFinished} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /18 or over/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('link-club-stub')
    return onFinished
  }

  it('Skip for now completes onboarding and hands over to the caller', async () => {
    const onFinished = await toStep2()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(db.updates[db.updates.length - 1]).toEqual({ onboarding_completed: true })
  })

  it('linking also completes onboarding; Back returns to step 1', async () => {
    const onFinished = await toStep2()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'About your club' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('link-club-stub')
    fireEvent.click(screen.getByRole('button', { name: 'Linked' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(db.updates[db.updates.length - 1]).toEqual({ onboarding_completed: true })
  })
})
