/**
 * Open to play (Figma D2.4): the switch shows for 18+; 16–17 get a neutral
 * line and no switch; no date of birth → ask for it; a legacy "on" minor can
 * still turn it off. Save goes through useOpenToPlay().save.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const otp = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/hooks/useOpenToPlay', () => ({ useOpenToPlay: () => otp.value }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'u1' }, profile: { id: 'u1', role: 'player', position: 'midfielder', nationality_country_id: 1, nationality2_country_id: null, highlight_video_url: null } }
  return { useAuthStore: (sel: (s: typeof state) => unknown) => sel(state) }
})
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [{ id: 1, code: 'AR', name: 'Argentina', common_name: null, flag_emoji: '🇦🇷' }] }), isEuCountryCode: () => false }))
vi.mock('@/hooks/usePlayerLeague', () => ({ usePlayerLeague: () => ({ league: null, loading: false }) }))
vi.mock('@/hooks/useProfileScrollData', () => ({ useProfileScrollData: () => ({ highlights: [{}], fullMatches: [], fullGameLinks: [] }) }))

import OpenToPlayScreen from '@/components/profile/mobile/OpenToPlayScreen'

const base = { canToggle: true, canToggleLoading: false, needsDob: false, openToPlay: true, availableFrom: '2026-09-01', availabilityDuration: 'full_season', confirmedAt: null }
const renderScreen = (onDone = vi.fn(), onAdd = vi.fn()) => { render(<OpenToPlayScreen onDone={onDone} onAdd={onAdd} />); return { onDone, onAdd } }

beforeEach(() => { otp.value = { ...base, save: vi.fn().mockResolvedValue({ ok: true, outcome: 'saved', confirmedAt: 'x' }) } })

describe('OpenToPlayScreen', () => {
  it('18+: switch, When, live checklist and consent; Save writes open + from + for', async () => {
    const { onDone, onAdd } = renderScreen()
    expect(screen.getByRole('switch', { name: 'I’m open to play' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('When')).toBeTruthy()
    expect(screen.getByText('1 highlight')).toBeTruthy()
    expect(screen.getByText(/Hockia can suggest your profile to clubs looking for a midfielder/)).toBeTruthy()
    fireEvent.click(screen.getByText('Add'))
    expect(onAdd).toHaveBeenCalledWith('league')
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect((otp.value.save as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ open: true, availableFrom: '2026-09-01', duration: 'full_season' })
  })

  it('16–17: no switch, a neutral line, Save disabled', () => {
    otp.value = { ...otp.value, canToggle: false, openToPlay: false }
    renderScreen()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByTestId('open-to-play-under-18')).toBeTruthy()
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('no date of birth: asks for it', () => {
    otp.value = { ...otp.value, canToggle: false, openToPlay: false, needsDob: true }
    const { onAdd } = renderScreen()
    fireEvent.click(screen.getByText('Add date of birth'))
    expect(onAdd).toHaveBeenCalledWith('dob')
  })

  it('a minor still "on" from before can only turn it off', () => {
    otp.value = { ...otp.value, canToggle: false, openToPlay: true }
    renderScreen()
    const sw = screen.getByRole('switch')
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })
})
