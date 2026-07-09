/**
 * Phase 3c — CreateOpportunityModal must-have capture side.
 *
 * Verifies the form WRITES the six `*_required` booleans into the
 * opportunities insert/update payload (the scoring side is covered by
 * clubFit/interestFit/recruiterVerdict; the activation RPC by
 * useRecruitingContext). Contract:
 *   - Untoggled criteria default to false on insert.
 *   - Toggling "Must have" persists the flag true.
 *   - A must-have on an unset OPTIONAL criterion blocks save with an error.
 *   - Coach opportunities render no toggles and send every flag false.
 *   - Editing round-trips an existing flag (initial state + update payload).
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CreateOpportunityModal from '@/components/CreateOpportunityModal'

// ── Supabase: capture insert / update payloads ──
let insertPayload: Record<string, unknown> | null = null
let updatePayload: Record<string, unknown> | null = null
const insertMock = vi.fn(async (payload: Record<string, unknown>) => {
  insertPayload = payload
  return { error: null }
})
const updateEqMock = vi.fn().mockResolvedValue({ error: null })
const updateMock = vi.fn((payload: Record<string, unknown>) => {
  updatePayload = payload
  return { eq: updateEqMock }
})
vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => insertMock(payload),
      update: (payload: Record<string, unknown>) => updateMock(payload),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const authState = {
  user: { id: 'club-1' },
  profile: { id: 'club-1', role: 'club' as const, current_world_club_id: null },
}
vi.mock('@/lib/auth', () => ({ useAuthStore: () => authState }))

const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast }) }))

vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ getCountryById: (id: number) => ({ id, name: 'Netherlands', code: 'NL' }) }),
}))

vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackVacancyCreate: vi.fn() }))
vi.mock('@/hooks/useWorldClubLogo', () => ({
  getClubLevelBand: () => null,
  prefetchWorldClubLogos: vi.fn(),
}))
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }))

// LocationAutocomplete → a button that selects a fixed city/country.
vi.mock('@/components/LocationAutocomplete', () => ({
  __esModule: true,
  default: ({ onLocationSelect }: { onLocationSelect: (l: { city: string; countryId: number }) => void }) => (
    <button type="button" data-testid="stub-set-location" onClick={() => onLocationSelect({ city: 'Amsterdam', countryId: 30 })}>
      set location
    </button>
  ),
}))

// SpecialistSkillsSelect → a button that adds one skill.
vi.mock('@/components/SpecialistSkillsSelect', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (next: string[]) => void }) => (
    <button type="button" data-testid="stub-add-skill" onClick={() => onChange(['drag_flicker'])}>
      add skill
    </button>
  ),
}))

const noop = () => {}
const user = userEvent.setup()

const renderModal = (props: Record<string, unknown> = {}) =>
  render(<CreateOpportunityModal isOpen onClose={noop} onSuccess={noop} {...props} />)

/** Fill the always-required fields of a NEW player opportunity. */
async function fillPlayerRequired() {
  await user.type(screen.getByLabelText(/Opportunity Title/), 'Senior Women First XI')
  await user.selectOptions(screen.getByTitle('Position'), 'midfielder')
  await user.selectOptions(screen.getByTitle('Category'), 'Women')
  await user.click(screen.getByTestId('stub-set-location'))
}

beforeEach(() => {
  insertMock.mockClear()
  updateMock.mockClear()
  updateEqMock.mockClear()
  addToast.mockClear()
  // The modal debounce-saves a draft to localStorage (600ms) and RESTORES it on
  // the next open — restored opportunity_type overrides the initialOpportunityType
  // prop. jsdom localStorage persists across tests in this file, so on a slow
  // runner (CI + coverage) an earlier player-mode test's draft leaks into the
  // coach test and renders player switches. Flaked CI run 29057065232.
  window.localStorage.clear()
})

describe('CreateOpportunityModal — must-have payload (Phase 3c)', () => {
  it('defaults all six *_required flags to false on insert', async () => {
    renderModal()
    await fillPlayerRequired()
    await user.click(screen.getByRole('button', { name: /Publish now/ }))

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1))
    expect(insertPayload).toMatchObject({
      position_required: false,
      level_required: false,
      compensation_required: false,
      location_required: false,
      availability_required: false,
      specialists_required: false,
    })
  })

  it('persists a toggled must-have (position + specialists) as true', async () => {
    renderModal()
    await fillPlayerRequired()
    await user.click(screen.getByRole('switch', { name: /Mark position as a must-have/ }))
    await user.click(screen.getByTestId('stub-add-skill'))
    await user.click(screen.getByRole('switch', { name: /Mark specialist skills as a must-have/ }))
    await user.click(screen.getByRole('button', { name: /Publish now/ }))

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1))
    expect(insertPayload).toMatchObject({
      position_required: true,
      specialists_required: true,
      level_required: false,
    })
  })

  it('blocks save when a must-have is set on an unset optional criterion', async () => {
    renderModal()
    await fillPlayerRequired()
    // Mark "level" must-have WITHOUT picking a level.
    await user.click(screen.getByRole('switch', { name: /Mark level as a must-have/ }))
    await user.click(screen.getByRole('button', { name: /Publish now/ }))

    expect(await screen.findByText(/Pick a level before marking it must-have/)).toBeTruthy()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('coach opportunities render no must-have toggles and send every flag false', async () => {
    renderModal({ initialOpportunityType: 'coach' })
    expect(screen.queryByRole('switch')).toBeNull()

    await user.type(screen.getByLabelText(/Opportunity Title/), 'Head Coach — Youth')
    await user.click(screen.getByTestId('stub-set-location'))
    await user.click(screen.getByRole('button', { name: /Publish now/ }))

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1))
    expect(insertPayload).toMatchObject({
      opportunity_type: 'coach',
      position_required: false,
      level_required: false,
      compensation_required: false,
      location_required: false,
      availability_required: false,
      specialists_required: false,
    })
  })

  it('round-trips an existing must-have on edit (initial state + update payload)', async () => {
    const editingVacancy = {
      id: 'opp-1',
      opportunity_type: 'player',
      title: 'Existing Opp',
      position: 'midfielder',
      gender: 'Women',
      location_city: 'Amsterdam',
      location_country: 'Netherlands',
      position_required: true,
    } as unknown as Parameters<typeof CreateOpportunityModal>[0]['editingVacancy']

    renderModal({ editingVacancy })

    // The position toggle reflects the persisted flag…
    expect(screen.getByRole('switch', { name: /Mark position as a must-have/ })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: /Update Opportunity/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updatePayload).toMatchObject({ position_required: true })
  })
})
