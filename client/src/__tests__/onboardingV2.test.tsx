/**
 * Account-first onboarding (founder rulings 2026-10-03; Figma 04 Player
 * 104:2096 / 114:434 / 101:892 / 114:537 / 114:608).
 *
 * Pins: route order account → role → set-up; role-card copy rulings; an OAuth
 * return lands on "Choose your role" with no overlay; step 2 is skippable;
 * the under-18 line promises nothing; funnel events fire at the same semantic
 * points as before and in order.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const events: string[] = []
  const profile: { current: Record<string, unknown> | null } = { current: null }
  const user = { id: 'u-1', email: 'new@example.com', created_at: new Date().toISOString(), user_metadata: {} }
  const updates: Record<string, unknown>[] = []
  const rpc = vi.fn(async (name: string) => {
    if (name === 'create_profile_for_new_user') return { data: { id: 'u-1' }, error: null }
    if (name === 'declare_date_of_birth') return { data: { outcome: 'confirmed' }, error: null }
    if (name === 'has_accepted_terms') return { data: false, error: null }
    if (name === 'set_open_to_play') return { data: { outcome: 'saved', availability_confirmed_at: 'now' }, error: null }
    return { data: null, error: null }
  })
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }),
    update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null } } }),
  }))
  const signedOut = { current: false }
  return { events, profile, user, updates, rpc, from, signedOut, signUp: vi.fn(), navigate: vi.fn() }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signUp: mocks.signUp, refreshSession: async () => ({ error: null }) },
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
  SUPABASE_URL: 'http://localhost',
  AUTH_STORAGE_KEY: 'hockia-auth',
}))
vi.mock('@/lib/auth', () => {
  const state = () => ({
    user: mocks.signedOut.current ? null : mocks.user,
    profile: mocks.profile.current,
    profileStatus: mocks.profile.current ? 'loaded' : 'missing',
    loading: false,
    profileFetchedAt: 1,
    fetchProfile: vi.fn(async () => undefined),
    setProfile: vi.fn(),
    refreshProfile: vi.fn(),
  })
  const useAuthStore = Object.assign((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()), {
    getState: state,
    subscribe: () => () => undefined,
  })
  return { useAuthStore }
})
vi.mock('@/lib/analytics', () => ({
  trackSignUpStart: (s: string) => mocks.events.push(`sign_up_start:${s}`),
  trackSignUp: (s: string) => mocks.events.push(`sign_up:${s}`),
  trackRoleSelected: (r: string) => mocks.events.push(`role_selected:${r}`),
  trackOnboardingStart: (r: string) => mocks.events.push(`onboarding_start:${r}`),
  trackOnboardingComplete: (r: string) => mocks.events.push(`onboarding_complete:${r}`),
  trackLogin: vi.fn(),
  trackLoginFailed: vi.fn(),
}))
vi.mock('@/lib/trackDbEvent', () => ({
  trackDbEvent: (event: string, _c: string, _u: string | undefined, meta?: Record<string, unknown>) =>
    mocks.events.push(`db:${event}${meta?.step ? `:${String(meta.step)}` : ''}${meta?.wizard_step ? `:${String(meta.wizard_step)}` : ''}`),
  consumeWallIntent: () => null,
}))
vi.mock('@/lib/attribution', () => ({
  getAttributionSnapshot: () => ({ src: 'test' }),
  getAttributionState: () => null,
  submitSignupAttribution: () => mocks.events.push('attribution_submitted'),
}))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn(async () => undefined) }))
vi.mock('@/lib/rateLimit', () => ({
  checkSignupRateLimit: async () => ({ allowed: true }),
  checkLoginRateLimit: async () => ({ allowed: true }),
  formatRateLimitError: () => 'limited',
}))
vi.mock('@/lib/oauthSignIn', () => ({ startOAuthSignIn: vi.fn(async () => undefined) }))
vi.mock('@/lib/inAppBrowser', () => ({
  supportsReliableOAuth: () => true,
  detectInAppBrowser: () => ({ isInAppBrowser: false, browserName: null }),
}))
vi.mock('@/lib/siteUrl', () => ({ getAuthRedirectUrl: () => 'http://localhost/auth/callback' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/openToPlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/openToPlay')>()
  return { ...actual, setOpenToPlay: vi.fn(async () => { mocks.events.push('set_open_to_play'); return { ok: true, outcome: 'saved', confirmedAt: 'now' } }) }
})
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/usePendingStorageCleanup', () => ({
  usePendingStorageCleanup: () => ({ queue: vi.fn(), unqueue: vi.fn(), flush: vi.fn(async () => undefined) }),
}))
// Heavy pickers (Google Places, world-club search, league lookup) are not what
// these tests pin; stand-ins keep the labels so the screen reads the same.
vi.mock('@/components/LocationAutocomplete', () => ({
  default: ({ label }: { label: string }) => <label>{label}<input /></label>,
}))
vi.mock('@/components/WorldClubSearch', () => ({
  default: ({ label }: { label: string }) => <label>{label}<input /></label>,
}))
vi.mock('@/components/CountrySelect', () => ({
  default: ({ label }: { label: string }) => <label>{label}<input /></label>,
}))
vi.mock('@/components/profile/mobile/PlayerLeagueField', () => ({
  PlayerLeagueField: () => <p>League</p>,
}))
vi.mock('@/components', () => ({
  InAppBrowserWarning: () => null,
  Input: (p: Record<string, unknown>) => <input {...(p as object)} />,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  CountrySelect: () => null,
  LocationAutocomplete: () => null,
  MultiCategorySelector: () => null,
  DateOfBirthPicker: () => null,
}))
vi.mock('@/components/ClubClaimStep', () => ({ default: () => null }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn(), setTag: vi.fn() }))

import SignUp from '@/pages/SignUp'
import CreateWithEmail from '@/pages/CreateWithEmail'
import CompleteProfile from '@/pages/CompleteProfile'
import PlayerSetupFlow from '@/components/onboarding/PlayerSetupFlow'
import TermsGate from '@/components/TermsGate'
import AgeGate from '@/components/AgeGate'
import { ROLE_CARDS, roleCtaLabel, passwordProblem, aboutYouProblem, offersOpenToPlay } from '@/lib/onboardingV2'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="path">{pathname}</div>
}

const renderAuthRoutes = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signup/email" element={<CreateWithEmail />} />
        <Route path="/signin" element={<div>LOGIN SCREEN</div>} />
        <Route path="/verify-email" element={<div>VERIFY EMAIL</div>} />
      </Routes>
    </MemoryRouter>,
  )

const years = (n: number) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  mocks.events.length = 0
  mocks.updates.length = 0
  mocks.profile.current = null
  mocks.user.user_metadata = {}
  mocks.signedOut.current = false
  mocks.signUp.mockReset()
  mocks.rpc.mockClear()
  localStorage.clear()
})

describe('route order: account first, then role, then set-up', () => {
  it('First run (104:2096): headline, Apple then Google, Create with email, Log in — no role cards', () => {
    mocks.signedOut.current = true
    renderAuthRoutes('/signup')
    expect(screen.getByRole('heading', { name: 'Your game. Your network.' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Continue with Apple', 'Continue with Google', 'Create with email'])
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/signin')
    expect(screen.queryByText(/join as/i)).not.toBeInTheDocument()
  })

  it('Create with email (114:434): no role, no DOB — the account is created with attribution only, then /verify-email', async () => {
    const user = userEvent.setup()
    mocks.signedOut.current = true
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
    renderAuthRoutes('/signup')
    await user.click(screen.getByRole('button', { name: 'Create with email' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/signup/email')
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument()
    expect(screen.getByText(/by continuing, you agree/i)).toBeInTheDocument()
    expect(screen.queryByText(/date of birth/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'longenough')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1))
    const options = mocks.signUp.mock.calls[0][0].options
    expect(options.data).toEqual({ acq: { src: 'test' } })
    expect(options.data.role).toBeUndefined()
    expect(options.data.dob).toBeUndefined()
    expect(localStorage.getItem('pending_role')).toBeNull()
    await waitFor(() => expect(screen.getByText('VERIFY EMAIL')).toBeInTheDocument())
    expect(mocks.events).toEqual(['sign_up_start:email', 'sign_up:pending_role'])
  })

  it('password rule is exactly "At least 8 characters"', () => {
    expect(passwordProblem('short')).toMatch(/8 characters/)
    expect(passwordProblem('abcdefgh')).toBeNull()
  })
})

describe('Choose your role (101:892)', () => {
  it('renders after the account exists, with the ruled copy, and creates the profile from the choice', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/complete-profile']}><CompleteProfile /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Choose your role' })).toBeInTheDocument()
    expect(screen.getByText('You can’t change it later without support.')).toBeInTheDocument()

    const cards = screen.getAllByRole('radio')
    expect(cards.map((c) => within(c).getByText(/^(Player|Coach|Club|Brand|Umpire)$/).textContent)).toEqual(['Player', 'Coach', 'Club', 'Brand', 'Umpire'])
    const umpire = ROLE_CARDS.find((c) => c.role === 'umpire')!
    expect(umpire.detail.toLowerCase()).not.toMatch(/appoint/)
    expect(umpire.detail).toMatch(/officiating history/)
    expect(ROLE_CARDS.find((c) => c.role === 'club')!.detail).toBe('Recruit field hockey players with trust and context')
    expect(screen.queryByText(/ai fit/i)).not.toBeInTheDocument()
    // No counts, scores or levels on any card.
    expect(screen.queryByText(/\d/)).not.toBeInTheDocument()

    const cta = screen.getByRole('button', { name: 'Continue' })
    expect(cta).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /^Player/ }))
    expect(screen.getByRole('button', { name: 'Continue as a player' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Continue as a player' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('create_profile_for_new_user', { user_id: 'u-1', user_email: 'new@example.com', user_role: 'player' }))
    expect(mocks.events[0]).toBe('role_selected:player')
    expect(mocks.events).toContain('db:onboarding_step:role_selected')
  })

  it('CTA pattern handles the article: an umpire', () => {
    expect(roleCtaLabel('umpire')).toBe('Continue as an umpire')
    expect(roleCtaLabel('club')).toBe('Continue as a club')
    expect(roleCtaLabel(null)).toBe('Continue')
  })

  it('OAuth return: lands on Choose your role with NO overlay (TermsGate / AgeGate render it in the clear)', async () => {
    render(
      <MemoryRouter initialEntries={['/complete-profile']}>
        <TermsGate>
          <AgeGate>
            <CompleteProfile />
          </AgeGate>
        </TermsGate>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Choose your role' })).toBeInTheDocument()
    expect(screen.queryByText(/terms of use/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('has_accepted_terms', expect.anything())
  })
})

describe('Set up (114:537 / 114:608)', () => {
  const playerProfile = (dob: string) => ({
    id: 'u-1', role: 'player', onboarding_completed: false,
    full_name: 'Sam Rivers', date_of_birth: dob, position: 'midfielder', secondary_position: null, playing_category: 'adult_women',
    avatar_url: null, current_club: null, current_world_club_id: null, base_location: null, base_city: null, base_country_id: null,
    nationality_country_id: null, nationality2_country_id: null,
  })

  it('step 1 gate: name, DOB, category and position are required; second position must differ', () => {
    expect(aboutYouProblem({ fullName: '', dateOfBirth: '', playingCategory: '', position: '', secondaryPosition: '' })).toMatch(/full name/)
    expect(aboutYouProblem({ fullName: 'A', dateOfBirth: '', playingCategory: '', position: '', secondaryPosition: '' })).toMatch(/date of birth/)
    expect(aboutYouProblem({ fullName: 'A', dateOfBirth: '2000-01-01', playingCategory: 'adult_men', position: 'forward', secondaryPosition: 'forward' })).toMatch(/different/)
    expect(aboutYouProblem({ fullName: 'A', dateOfBirth: '2000-01-01', playingCategory: 'adult_men', position: 'forward', secondaryPosition: '' })).toBeNull()
  })

  it('step 1 renders the About you fields with the photo helper and saves DOB through the existing gate', async () => {
    const user = userEvent.setup()
    mocks.profile.current = { ...playerProfile(years(25)), full_name: '', date_of_birth: null, position: null, playing_category: null }
    const onFinished = vi.fn()
    render(<MemoryRouter><PlayerSetupFlow onFinished={onFinished} /></MemoryRouter>)
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(screen.getByText('A real match photo gets more profile views.')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByText('Date of birth')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    expect(screen.getByLabelText('Position')).toBeInTheDocument()
    expect(screen.getByLabelText('Second position (optional)')).toBeInTheDocument()

    // The Day/Month/Year picker is unchanged: years descend from a recent one
    // (was pinned on the public sign-up path before the account-first flow).
    const yearValues = Array.from((screen.getByLabelText('Year') as HTMLSelectElement).options).map((o) => Number(o.value)).filter((v) => v > 0)
    expect(yearValues.length).toBeGreaterThanOrEqual(90)
    expect(yearValues.every((v, i) => i === 0 || v < yearValues[i - 1])).toBe(true)

    await user.type(screen.getByLabelText('Full name'), 'Sam Rivers')
    await user.selectOptions(screen.getByLabelText('Day'), '1')
    await user.selectOptions(screen.getByLabelText('Month'), '1')
    await user.selectOptions(screen.getByLabelText('Year'), '2000')
    await user.selectOptions(screen.getByLabelText('Category'), 'adult_women')
    await user.selectOptions(screen.getByLabelText('Position'), 'midfielder')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('declare_date_of_birth', { p_dob: '2000-01-01' }))
    await waitFor(() => expect(screen.getByText('Step 2 of 2')).toBeInTheDocument())
    expect(mocks.updates[0]).toMatchObject({ role: 'player', full_name: 'Sam Rivers', playing_category: 'adult_women', position: 'midfielder', secondary_position: null })
    expect(mocks.updates[0]).not.toHaveProperty('date_of_birth')
    expect(mocks.events).toContain('db:onboarding_step:wizard_step_completed:1')
  })

  it('step 2 (adult): Open to play switch with the ruled line; Skip finishes onboarding without touching the fields', async () => {
    const user = userEvent.setup()
    mocks.profile.current = playerProfile(years(25))
    const onFinished = vi.fn()
    render(<MemoryRouter><PlayerSetupFlow onFinished={onFinished} /></MemoryRouter>)
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Where you play' })).toBeInTheDocument()
    expect(screen.getByText('Current club')).toBeInTheDocument()
    expect(screen.getByText('Base location')).toBeInTheDocument()
    expect(screen.getByText('Passport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add second/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Open to play' })).toBeChecked()
    expect(screen.getByText('Clubs can see you and message you about roles.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(mocks.updates).toEqual([{ onboarding_completed: true }])
    expect(mocks.events).toContain('db:onboarding_step:wizard_step_skipped:2')
    expect(mocks.events).not.toContain('set_open_to_play')
  })

  it('step 2 (adult) Continue: saves the fields, confirms Open to play through set_open_to_play, finishes', async () => {
    const user = userEvent.setup()
    mocks.profile.current = playerProfile(years(25))
    const onFinished = vi.fn()
    render(<MemoryRouter><PlayerSetupFlow onFinished={onFinished} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(mocks.updates[0]).toMatchObject({ onboarding_completed: true, nationality_country_id: null })
    expect(mocks.updates[0]).not.toHaveProperty('open_to_play')
    expect(mocks.events).toContain('set_open_to_play')
    expect(mocks.events).toContain('db:onboarding_step:wizard_step_completed:2')
  })

  it('under 18 (16–17): no switch, and the line promises nothing about being suggested', () => {
    mocks.profile.current = playerProfile(years(16))
    render(<MemoryRouter><PlayerSetupFlow onFinished={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    const line = screen.getByText(/18 and over/)
    expect(line).toHaveTextContent(/aren’t suggested/)
    expect(line.textContent).not.toMatch(/will be suggested|get suggested|can suggest/)
    expect(offersOpenToPlay(years(16))).toBe(false)
    expect(offersOpenToPlay(years(18))).toBe(true)
  })

  it('a saved date of birth is shown locked, never re-asked (immutable after save)', () => {
    mocks.profile.current = { ...playerProfile('2000-01-01'), position: null }
    render(<MemoryRouter><PlayerSetupFlow onFinished={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Locked after registration.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()
  })
})

describe('funnel events keep their order through the whole flow', () => {
  it('role chosen → onboarding_start → steps → onboarding_complete (+ attribution) on CompleteProfile', async () => {
    const user = userEvent.setup()
    mocks.profile.current = {
      id: 'u-1', role: 'player', onboarding_completed: false, full_name: 'Sam Rivers', date_of_birth: years(25),
      position: 'midfielder', secondary_position: null, playing_category: 'adult_men', avatar_url: null,
      current_club: null, current_world_club_id: null, base_location: null, base_city: null, base_country_id: null,
      nationality_country_id: null, nationality2_country_id: null,
    }
    render(<MemoryRouter initialEntries={['/complete-profile']}><CompleteProfile /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(mocks.events).toContain('onboarding_complete:player'))
    const order = mocks.events.filter((e) => !e.startsWith('db:onboarding_step:wizard_step_viewed'))
    expect(order.indexOf('onboarding_start:player')).toBeLessThan(order.indexOf('db:onboarding_step:wizard_step_skipped:2'))
    expect(order.indexOf('db:onboarding_step:wizard_step_skipped:2')).toBeLessThan(order.indexOf('onboarding_complete:player'))
    expect(order.indexOf('onboarding_complete:player')).toBeLessThan(order.indexOf('db:onboarding_completed'))
    expect(order.indexOf('db:onboarding_completed')).toBeLessThan(order.indexOf('attribution_submitted'))
    expect(mocks.events).toContain('db:registration_started')
  })
})
