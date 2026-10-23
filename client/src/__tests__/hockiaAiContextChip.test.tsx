/**
 * The Hockia AI sheet's context chip and role choices, rendered
 * (one-sheet handoff 2026-10-22). Counts come from mocked reads; the
 * chip is removable and then the sheet offers general questions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const rpc = vi.fn()
const head = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => head() }) }),
  },
}))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components/FeedbackModal', () => ({ default: () => <div data-testid="feedback-modal" /> }))
vi.mock('@/components/hockiaAi/useNextSteps', () => ({ useNextSteps: () => ({ facts: null, steps: null, reload: vi.fn() }) }))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingContext: () => ({ active: { label: 'Left back' } }) }))

type Profile = { id: string; role: string; full_name: string; position?: string; coach_recruits_for_team?: boolean }
const authState: { user: { id: string }; profile: Profile } = { user: { id: 'u1' }, profile: { id: 'u1', role: 'player', full_name: 'Alex Rivera', position: 'midfielder' } }
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
    { getState: () => authState },
  ),
}))

import { HockiaAiSheet } from '@/components/hockiaAi/HockiaAiSheet'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import { useDiscoverChat } from '@/hooks/useDiscover'

function renderSheet() {
  useHockiaAiSheet.getState().show('header')
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <HockiaAiSheet />
      <Routes>
        <Route path="/home" element={<div>Home page</div>} />
        <Route path="/dashboard/profile" element={<div>Umpire dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  rpc.mockReset()
  head.mockReset()
  useDiscoverChat.setState({ messages: [], isPending: false, sendMessage: vi.fn() })
  useHockiaAiSheet.setState({ open: false, pageFacts: {}, contextOff: false })
})

describe('Hockia AI context chip', () => {
  it('player: "Your profile · Midfielder" and three choices; a choice sends', () => {
    authState.profile = { id: 'u1', role: 'player', full_name: 'Alex Rivera', position: 'midfielder' }
    renderSheet()
    expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Your profile · Midfielder')
    expect(screen.getByTestId('hockia-ai-intro')).toHaveTextContent('I can see your profile.')
    const choices = screen.getAllByTestId('hockia-ai-context-choice')
    expect(choices.map((c) => c.textContent)).toEqual(['DO IT FOR MEFind roles that fit me', 'ASKCheck my profile against a role', 'DO IT FOR MEFill my profile from my files'])
    fireEvent.click(choices[0])
    expect(useDiscoverChat.getState().sendMessage).toHaveBeenCalledWith('Find roles that fit me', undefined, undefined)
  })

  it('removing the chip leaves general questions', () => {
    authState.profile = { id: 'u1', role: 'player', full_name: 'Alex Rivera', position: 'midfielder' }
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Remove context: ask a general question' }))
    expect(screen.queryByTestId('hockia-ai-context-chip')).toBeNull()
    expect(screen.queryByTestId('hockia-ai-context-choice')).toBeNull()
    expect(screen.getAllByTestId('hockia-ai-suggestion').length).toBeGreaterThan(0)
    // Reopening brings the context back.
    useHockiaAiSheet.getState().show('header')
    expect(useHockiaAiSheet.getState().contextOff).toBe(false)
  })

  it('club: open roles and waiting applicants from roles health; the active role is named', async () => {
    authState.profile = { id: 'c1', role: 'club', full_name: 'Lazio Hockey' }
    rpc.mockResolvedValue({ data: [{ pending_count: 3 }, { pending_count: 1 }], error: null })
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Your roles · 2 open'))
    expect(rpc).toHaveBeenCalledWith('get_my_roles_health')
    expect(screen.getAllByTestId('hockia-ai-context-choice').map((c) => c.textContent)).toEqual([
      'DO IT FOR MEFind available players for Left back', 'ASKSummarise my 4 applicants', 'DO IT FOR MEDraft a new role',
    ])
  })

  it('club: a failed read shows no count', async () => {
    authState.profile = { id: 'c1', role: 'club', full_name: 'Lazio Hockey' }
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
    renderSheet()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent(/^Your roles$/)
  })

  it('candidate coach: the count the Opportunities list published', () => {
    authState.profile = { id: 'k1', role: 'coach', full_name: 'Sam Lee' }
    useHockiaAiSheet.setState({ pageFacts: { coachingRolesOpen: 6 } })
    renderSheet()
    expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Coaching roles · 6 open')
  })

  it('umpire: appointments count; "Add my latest appointment" closes the sheet and opens the editor link', async () => {
    authState.profile = { id: 'm1', role: 'umpire', full_name: 'Kim Ola' }
    head.mockResolvedValue({ count: 12, error: null })
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Your record · 12 appointments'))
    fireEvent.click(screen.getAllByTestId('hockia-ai-context-choice')[0])
    expect(useHockiaAiSheet.getState().open).toBe(false)
    expect(screen.getByText('Umpire dashboard')).toBeInTheDocument()
  })

  it('brand: products count via get_my_brand → get_brand_products', async () => {
    authState.profile = { id: 'b1', role: 'brand', full_name: 'Grip Co' }
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'get_my_brand' ? { data: { id: 'brand-1' }, error: null } : { data: [{}, {}, {}], error: null }))
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Your products · 3'))
    expect(rpc).toHaveBeenCalledWith('get_brand_products', { p_brand_id: 'brand-1' })
  })
})
