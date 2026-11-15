/**
 * Home Next step: "Add your clubs" (2026-11-15). A player or coach with no
 * career on their profile gets a card that opens Hockia AI's "Fill my profile"
 * (CV or a few lines) instead of navigating; nobody else gets it.
 */
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  tracked: [] as Array<[string, unknown, unknown, Record<string, unknown> | undefined]>,
}))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ profile: state.profile, user: { id: 'u1' }, setProfile: vi.fn() }),
    { getState: () => ({ profile: state.profile, user: { id: 'u1' } }) },
  ),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: [string, unknown, unknown, Record<string, unknown> | undefined]) => { state.tracked.push(a) } }))
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticSelection: vi.fn() }))
vi.mock('@/hooks/useWeeklyVisibility', () => ({ useWeeklyVisibility: () => ({ visibility: { views_7d: 0 }, loading: false }) }))
vi.mock('@/hooks/useOpportunitiesForYou', () => ({ useOpportunitiesForYou: () => ({ items: [], mode: 'none', loading: false }) }))
vi.mock('@/hooks/useMyApplications', () => ({ useMyApplications: () => ({ applications: [], loading: false }) }))
vi.mock('@/hooks/useRolesHealth', () => ({ useRolesHealth: () => ({ roles: [], totals: { pending: 0 }, loading: false }) }))
vi.mock('@/hooks/useScopedMatches', () => ({ useScopedMatches: () => ({ matches: [], loading: false }) }))
vi.mock('@/hooks/useMyPulse', () => ({ useMyPulse: () => ({ items: [], isLoading: false, markActionCompleted: vi.fn(), markDismissed: vi.fn() }) }))
vi.mock('@/hooks/useCoachPulseMode', () => ({ useCoachPulseMode: () => ['talent', vi.fn()] }))
vi.mock('@/hooks/useSearchAppearances', () => ({ useSearchAppearances: () => ({ summary: null }) }))

import { useNextStep } from '@/components/home/v1/useNextStep'
import { NextStepCard } from '@/components/home/v1/NextStepCard'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'

const player = (over: Record<string, unknown> = {}) => ({ id: 'u1', role: 'player', avatar_url: 'a.jpg', career_entry_count: 0, profile_completeness_pct: 100, ...over })
const keys = () => renderHook(() => useNextStep()).result.current.steps.map((s) => s.key)

beforeEach(() => {
  state.tracked.length = 0
  useHockiaAiSheet.setState({ open: false, mode: 'chat', entry: 'opportunities' })
})

describe('useNextStep: clubs from a CV', () => {
  it('offers it to a player with no career, opening Hockia AI rather than a page', () => {
    state.profile = player()
    const step = renderHook(() => useNextStep()).result.current.steps.find((s) => s.key === 'career')
    expect(step).toMatchObject({ title: 'Add your clubs', subtitle: 'From your CV or a few lines', cta: 'Start', action: 'fill_profile' })
    expect(step?.to).toBeUndefined()
  })

  it('offers it to a coach with no career', () => {
    state.profile = player({ role: 'coach' })
    expect(keys()).toContain('career')
  })

  it('comes before the "Complete your profile" tip', () => {
    state.profile = player({ profile_completeness_pct: 40 })
    const k = keys()
    expect(k.indexOf('career')).toBeGreaterThanOrEqual(0)
    expect(k.indexOf('career')).toBeLessThan(k.indexOf('complete'))
  })

  it('is not shown once the profile has a club, nor to clubs, brands or umpires', () => {
    state.profile = player({ career_entry_count: 1 })
    expect(keys()).not.toContain('career')
    for (const role of ['club', 'brand', 'umpire']) {
      state.profile = player({ role })
      expect(keys()).not.toContain('career')
    }
  })
})

describe('NextStepCard: clubs from a CV', () => {
  it('opens the profile builder from Home and reports the tap', () => {
    state.profile = player()
    render(<MemoryRouter><NextStepCard onCompose={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Add your clubs/ }))
    expect(useHockiaAiSheet.getState()).toMatchObject({ open: true, mode: 'builder', entry: 'home', detent: 'large' })
    expect(state.tracked.some(([name, , , props]) => name === 'next_step_action' && props?.key === 'career' && props?.action === 'open')).toBe(true)
  })
})
