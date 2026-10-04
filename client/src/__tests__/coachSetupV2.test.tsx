/**
 * Coach set-up v2 (Figma New-Hockia D6.5 586:806 · D6.6 586:849 · D6.6b
 * 587:911 · dev note 587:1030; founder rulings 2026-10-04/05).
 *
 * Pins: step order (About you → Your coaching); required categories and the
 * recruit answer with the exact error copy; nothing preselected; Other →
 * role title; Skip saves recruits=false + Open to coach ON; the Finish payload
 * maps to the same columns the 3-step wizard wrote; funnel events; draft
 * restore and migration.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const events: string[] = []
  const profile: { current: Record<string, unknown> | null } = { current: null }
  const user = { id: 'u-1', email: 'coach@example.com', created_at: new Date().toISOString(), user_metadata: {} }
  const updates: Record<string, unknown>[] = []
  const rpc = vi.fn(async (name: string) => {
    if (name === 'declare_date_of_birth') return { data: { outcome: 'confirmed' }, error: null }
    return { data: null, error: null }
  })
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }),
    update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null } } }),
  }))
  return { events, profile, user, updates, rpc, from }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { refreshSession: async () => ({ error: null }) },
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
}))
vi.mock('@/lib/auth', () => {
  const state = () => ({
    user: mocks.user,
    profile: mocks.profile.current,
    fetchProfile: vi.fn(async () => undefined),
    setProfile: vi.fn(),
  })
  const useAuthStore = Object.assign((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()), { getState: state })
  return { useAuthStore }
})
vi.mock('@/lib/trackDbEvent', () => ({
  trackDbEvent: (event: string, _c: string, _u: string | undefined, meta?: Record<string, unknown>) =>
    mocks.events.push(`db:${event}${meta?.step ? `:${String(meta.step)}` : ''}${meta?.wizard_step ? `:${String(meta.wizard_step)}` : ''}${meta?.reason ? `:${String(meta.reason)}` : ''}`),
  consumeWallIntent: () => null,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [], loading: false, getCountryById: (id: number) => (id === 10 ? { id: 10, name: 'Argentina', nationality_name: 'Argentine' } : undefined) }),
}))
vi.mock('@/hooks/usePendingStorageCleanup', () => ({
  usePendingStorageCleanup: () => ({ queue: vi.fn(), unqueue: vi.fn(), flush: vi.fn(async () => undefined) }),
}))
// Stand-ins for the heavy pickers: same label, an input or a button that
// drives the callbacks the flow wires up, and the error line.
vi.mock('@/components/CountrySelect', () => ({
  default: ({ label, onChange, error, optional }: { label: string; onChange: (id: number | null) => void; error?: string; optional?: boolean }) => (
    <div>
      <button type="button" onClick={() => onChange(label === 'Nationality' ? 10 : 20)}>{`Pick ${label}`}</button>
      {optional && <span>{`${label} Optional`}</span>}
      {error && <p>{error}</p>}
    </div>
  ),
}))
vi.mock('@/components/LocationAutocomplete', () => ({
  default: ({ label, value, onChange, onLocationSelect, error }: { label: string; value: string; onChange: (v: string) => void; onLocationSelect: (l: { displayName: string; city: string; countryId: number }) => void; error?: string }) => (
    <div>
      <label>{label}<input value={value} onChange={(e) => onChange(e.target.value)} /></label>
      <button type="button" onClick={() => onLocationSelect({ displayName: 'Bahía Blanca, AR', city: 'Bahía Blanca', countryId: 10 })}>Pick city</button>
      {error && <p>{error}</p>}
    </div>
  ),
}))
vi.mock('@/components/WorldClubSearch', () => ({
  default: ({ label, onClubSelect, optional }: { label: string; onClubSelect: (c: { id: string; club_name: string }) => void; optional?: boolean }) => (
    <div>
      <span>{label}</span>
      {optional && <span>{`${label} Optional`}</span>}
      <button type="button" onClick={() => onClubSelect({ id: 'wc-1', club_name: 'Club Atlético Pacífico' })}>Pick club</button>
    </div>
  ),
}))

import CoachSetupFlow from '@/components/onboarding/CoachSetupFlow'
import {
  COACH_ERRORS,
  coachAboutYouErrors,
  coachCoachingErrors,
  coachDraftKey,
  legacyWizardDraftKey,
  parseCoachDraft,
  sentenceCaseLabel,
  serializeWizardDraft,
  toggleCoachCategory,
} from '@/lib/onboardingV2'

const years = (n: number) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

const newCoach = () => ({
  id: 'u-1', role: 'coach', onboarding_completed: false,
  full_name: '', date_of_birth: null, avatar_url: null,
  nationality_country_id: null, nationality2_country_id: null, base_location: null, base_city: null, base_country_id: null,
  coach_specialization: null, coach_specialization_custom: null, coaching_categories: null,
  current_club: null, current_world_club_id: null, coach_recruits_for_team: false,
})
/** Step 1 already saved → the flow resumes on step 2. */
const stepTwoCoach = () => ({
  ...newCoach(), full_name: 'Pablo Laschiaza', date_of_birth: years(34), nationality_country_id: 10, base_location: 'Bahía Blanca, AR',
})

const renderFlow = (onFinished = vi.fn()) => {
  render(<MemoryRouter><CoachSetupFlow onFinished={onFinished} /></MemoryRouter>)
  return onFinished
}

beforeEach(() => {
  mocks.events.length = 0
  mocks.updates.length = 0
  mocks.profile.current = null
  mocks.rpc.mockClear()
  localStorage.clear()
})

describe('rules', () => {
  it('step 1 needs name, DOB, nationality and base location', () => {
    expect(coachAboutYouErrors({ fullName: ' ', dateOfBirth: '', nationalityCountryId: null, location: '' })).toEqual({
      fullName: COACH_ERRORS.fullName, dateOfBirth: COACH_ERRORS.dateOfBirth, nationality: COACH_ERRORS.nationality, location: COACH_ERRORS.location,
    })
    expect(coachAboutYouErrors({ fullName: 'A', dateOfBirth: '1990-01-01', nationalityCountryId: 1, location: 'X' })).toEqual({})
  })
  it('step 2 needs specialization (+ role title for Other), ≥ 1 category and an explicit recruit answer', () => {
    expect(coachCoachingErrors({ specialization: '', specializationCustom: '', categories: [], recruitsForTeam: null })).toEqual({
      specialization: 'Please select your coaching specialization.',
      categories: 'Please select at least one coaching category.',
      recruits: 'Choose one to finish.',
    })
    expect(coachCoachingErrors({ specialization: 'other', specializationCustom: ' ', categories: ['any'], recruitsForTeam: false })).toEqual({
      specialization: 'Please enter your role title.',
    })
    // "Not right now" (false) is an answer.
    expect(coachCoachingErrors({ specialization: 'head_coach', specializationCustom: '', categories: ['girls'], recruitsForTeam: false })).toEqual({})
  })
  it('"Any category" stays exclusive', () => {
    expect(toggleCoachCategory(['girls', 'boys'], 'any', 'any')).toEqual(['any'])
    expect(toggleCoachCategory(['any'], 'girls', 'any')).toEqual(['girls'])
    expect(toggleCoachCategory(['any'], 'any', 'any')).toEqual([])
    expect(toggleCoachCategory(['girls'], 'girls', 'any')).toEqual([])
  })
  it('specialization labels are sentence case', () => {
    expect(sentenceCaseLabel('Head Coach')).toBe('Head coach')
    expect(sentenceCaseLabel('Strength & Conditioning Coach')).toBe('Strength & conditioning coach')
  })
})

describe('step 1 · About you (586:806)', () => {
  it('renders the fields, gates with inline errors, then saves through the DOB gate and moves to step 2', async () => {
    const user = userEvent.setup()
    mocks.profile.current = newCoach()
    renderFlow()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(screen.getByText('A clear coaching photo gets more views.')).toBeInTheDocument()
    expect(screen.getByText('Can’t be changed later. Never shown on your profile — only your age is.')).toBeInTheDocument()
    expect(screen.getByText('Second nationality Optional')).toBeInTheDocument()
    expect(screen.queryByText(/category/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(COACH_ERRORS.fullName)).toBeInTheDocument()
    expect(screen.getByText(COACH_ERRORS.dateOfBirth)).toBeInTheDocument()
    expect(screen.getByText(COACH_ERRORS.nationality)).toBeInTheDocument()
    expect(screen.getByText(COACH_ERRORS.location)).toBeInTheDocument()
    expect(mocks.events).toContain(`db:onboarding_step:wizard_step_validation_failed:1:${COACH_ERRORS.fullName}`)
    expect(mocks.updates).toHaveLength(0)

    await user.type(screen.getByLabelText('Full name'), 'Pablo Laschiaza')
    await user.selectOptions(screen.getByLabelText('Day'), '12')
    await user.selectOptions(screen.getByLabelText('Month'), '3')
    await user.selectOptions(screen.getByLabelText('Year'), '1992')
    await user.click(screen.getByRole('button', { name: 'Pick Nationality' }))
    await user.click(screen.getByRole('button', { name: 'Pick Second nationality' }))
    await user.click(screen.getByRole('button', { name: 'Pick city' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('declare_date_of_birth', { p_dob: '1992-03-12' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your coaching' })).toBeInTheDocument())
    expect(mocks.updates[0]).toEqual({
      role: 'coach',
      full_name: 'Pablo Laschiaza',
      nationality: 'Argentine',
      nationality_country_id: 10,
      nationality2_country_id: 20,
      base_location: 'Bahía Blanca, AR',
      base_city: 'Bahía Blanca',
      base_country_id: 10,
      avatar_url: null,
    })
    expect(mocks.events).toContain('db:onboarding_step:wizard_step_completed:1')
  })

  it('an under-18 answer stops set-up (the account is frozen server-side)', async () => {
    const user = userEvent.setup()
    mocks.rpc.mockImplementationOnce(async () => ({ data: { outcome: 'frozen' }, error: null }))
    mocks.profile.current = { ...newCoach(), full_name: 'Kid', nationality_country_id: 10, base_location: 'X' }
    renderFlow()
    await user.selectOptions(screen.getByLabelText('Day'), '1')
    await user.selectOptions(screen.getByLabelText('Month'), '1')
    await user.selectOptions(screen.getByLabelText('Year'), String(new Date().getUTCFullYear() - 15))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('declare_date_of_birth', expect.anything()))
    expect(mocks.updates).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument()
  })
})

describe('step 2 · Your coaching (586:849 / 587:911)', () => {
  it('nothing preselected; Finish shows the inline errors with the exact copy and saves nothing', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    const onFinished = renderFlow()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 2 · clubs filter coaches by these.')).toBeInTheDocument()
    expect(screen.getByText('Pick every category you coach.')).toBeInTheDocument()
    expect(screen.getByText('Current club Optional')).toBeInTheDocument()
    expect(screen.getByText('Yes adds My roles and Find players to your app. You can change this in Settings.')).toBeInTheDocument()
    for (const chip of ['Adult women', 'Adult men', 'Girls', 'Boys', 'Mixed', 'Any category']) {
      expect(screen.getByRole('button', { name: chip })).toHaveAttribute('aria-pressed', 'false')
    }
    const recruit = screen.getByRole('radiogroup', { name: 'Do you recruit players for a team?' })
    const radios = within(recruit).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      'Yes, I recruit for my teamPost roles and review applicants for your club.',
      'Not right nowUse Hockia for your own coaching career.',
    ])
    radios.forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'))
    expect((screen.getByLabelText('Specialization') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('switch', { name: 'Open to coach' })).toBeChecked()
    expect(screen.getByText('Clubs can see you’re available and message you.')).toBeInTheDocument()
    // Skip: a 44 pt text action in the nav bar.
    expect(screen.getByRole('button', { name: 'Skip' })).toHaveClass('h-11', 'min-w-[44px]')
    expect(screen.getAllByRole('button', { name: 'Finish' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Please select your coaching specialization.')).toBeInTheDocument()
    expect(screen.getByText('Please select at least one coaching category.')).toHaveClass('text-status-danger')
    expect(screen.getByText('Choose one to finish.')).toHaveClass('text-status-danger')
    expect(mocks.updates).toHaveLength(0)
    expect(onFinished).not.toHaveBeenCalled()
    expect(mocks.events.some((e) => e.startsWith('db:onboarding_step:wizard_step_validation_failed:2'))).toBe(true)
  })

  it('sentence-case specializations; Other reveals the role title and requires it', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    renderFlow()
    const select = screen.getByLabelText('Specialization') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toContain('Head coach')
    expect(screen.queryByLabelText('Role title')).not.toBeInTheDocument()
    await user.selectOptions(select, 'other')
    expect(screen.getByLabelText('Role title')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Please enter your role title.')).toBeInTheDocument()
  })

  it('Finish maps to the same columns the old wizard wrote, then fires the completion events', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    const onFinished = renderFlow()
    await user.selectOptions(screen.getByLabelText('Specialization'), 'other')
    await user.type(screen.getByLabelText('Role title'), 'Team manager')
    await user.click(screen.getByRole('button', { name: 'Adult women' }))
    await user.click(screen.getByRole('button', { name: 'Adult men' }))
    expect(screen.getByRole('button', { name: 'Adult women' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Pick club' }))
    await user.click(screen.getByRole('radio', { name: /Yes, I recruit for my team/ }))
    expect(screen.getByRole('radio', { name: /Yes, I recruit for my team/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(mocks.updates).toEqual([{
      onboarding_completed: true,
      position: null,
      gender: null,
      coaching_categories: ['adult_women', 'adult_men'],
      category_confirmation_needed: false,
      current_club: 'Club Atlético Pacífico',
      current_world_club_id: 'wc-1',
      coach_specialization: 'other',
      coach_specialization_custom: 'Team manager',
      open_to_coach: true,
      coach_recruits_for_team: true,
    }])
    expect(mocks.events.filter((e) => !e.includes('validation_failed'))).toEqual([
      'db:onboarding_step:wizard_step_viewed:2',
      'db:onboarding_step:form_submitted',
      'db:onboarding_step:wizard_step_completed:2',
    ])
    expect(localStorage.getItem(coachDraftKey('u-1'))).toBeNull()
  })

  it('"Not right now" saves false; the switch turned off saves open_to_coach false', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    const onFinished = renderFlow()
    await user.selectOptions(screen.getByLabelText('Specialization'), 'head_coach')
    await user.click(screen.getByRole('button', { name: 'Any category' }))
    await user.click(screen.getByRole('radio', { name: /Not right now/ }))
    await user.click(screen.getByRole('switch', { name: 'Open to coach' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(mocks.updates[0]).toMatchObject({ coaching_categories: ['any'], coach_specialization: 'head_coach', coach_specialization_custom: null, coach_recruits_for_team: false, open_to_coach: false })
  })

  it('Skip saves recruits = false and Open to coach ON, no validation', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    const onFinished = renderFlow()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(mocks.updates).toEqual([{ onboarding_completed: true, coach_recruits_for_team: false, open_to_coach: true }])
    expect(mocks.events).toContain('db:onboarding_step:wizard_step_skipped:2')
    expect(screen.queryByText('Choose one to finish.')).not.toBeInTheDocument()
  })
})

describe('draft (hockia-onboarding-v2:coach:<uid>)', () => {
  it('typing is saved and restored on reload', async () => {
    const user = userEvent.setup()
    mocks.profile.current = newCoach()
    const { unmount } = render(<MemoryRouter><CoachSetupFlow onFinished={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText('Full name'), 'Jo Park')
    expect(parseCoachDraft(localStorage.getItem(coachDraftKey('u-1')))).toMatchObject({ fullName: 'Jo Park' })
    unmount()
    renderFlow()
    expect(screen.getByLabelText('Full name')).toHaveValue('Jo Park')
  })

  it('step 2 answers survive a reload', async () => {
    const user = userEvent.setup()
    mocks.profile.current = stepTwoCoach()
    const { unmount } = render(<MemoryRouter><CoachSetupFlow onFinished={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Girls' }))
    await user.click(screen.getByRole('radio', { name: /Not right now/ }))
    unmount()
    renderFlow()
    expect(screen.getByRole('button', { name: 'Girls' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: /Not right now/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('a 3-step wizard draft (old key, old shape) is migrated once; its implicit "Not right now" is not an answer', () => {
    localStorage.setItem(legacyWizardDraftKey('coach', 'u-1'), serializeWizardDraft(3, {
      fullName: 'Alex Kim', city: 'Rosario', coachingCategories: ['girls'], coachSpecialization: 'youth_coach', coachRecruitsForTeam: false,
    }))
    mocks.profile.current = newCoach()
    renderFlow()
    expect(screen.getByLabelText('Full name')).toHaveValue('Alex Kim')
    expect(localStorage.getItem(legacyWizardDraftKey('coach', 'u-1'))).toBeNull()
    const migrated = parseCoachDraft(localStorage.getItem(coachDraftKey('u-1')))
    expect(migrated).toMatchObject({ fullName: 'Alex Kim', location: 'Rosario', categories: ['girls'], specialization: 'youth_coach', recruitsForTeam: null })
  })
})
