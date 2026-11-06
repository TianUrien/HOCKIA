import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components/FeedbackModal', () => ({ default: () => <div data-testid="feedback-modal" /> }))
vi.mock('@/components/hockiaAi/useNextSteps', () => ({ useNextSteps: () => ({ facts: null, steps: null, reload: vi.fn() }) }))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingContext: () => ({ active: null }) }))
vi.mock('@/components/hockiaAi/useAiContextChip', () => ({ useAiContextChip: () => ({ kind: 'screen', topic: 'Opportunities', fact: '24 open' }) }))
// Web ≥1024 px.
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
const authState = { user: { id: 'p1' }, profile: { id: 'p1', role: 'player', full_name: 'Alex Rivera' } }
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign((selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState), { getState: () => authState }),
}))

import { HockiaAiSheet } from '@/components/hockiaAi/HockiaAiSheet'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
})

describe('Hockia AI on web ≥1024: the side panel (rebrand page 17, 2026-11-06)', () => {
  it('is a right-edge panel over a usable page: no dim, not modal, page clicks pass through', () => {
    useHockiaAiSheet.setState({ open: true, detent: 'medium', mode: 'chat', roleContext: null, seed: null })
    render(<MemoryRouter><HockiaAiSheet /></MemoryRouter>)
    expect(screen.queryByTestId('hockia-ai-dim')).toBeNull()
    expect(screen.getByTestId('hockia-ai-sheet-root').className).toContain('pointer-events-none')
    const panel = screen.getByTestId('hockia-ai-sheet')
    expect(panel.className).toContain('w-[440px]')
    expect(panel).not.toHaveAttribute('aria-modal')
  })

  it('has the panel header, the intro, the chip left-aligned and the choices; the composer stays', () => {
    useHockiaAiSheet.setState({ open: true, detent: 'medium', mode: 'chat', roleContext: null, seed: null })
    render(<MemoryRouter><HockiaAiSheet /></MemoryRouter>)
    expect(screen.getByTestId('hockia-ai-panel-header')).toHaveTextContent('Hockia AI')
    expect(screen.getByTestId('hockia-ai-intro')).toBeInTheDocument()
    expect(screen.getByTestId('hockia-ai-context-chip')).toHaveTextContent('Opportunities · 24 open')
    expect(screen.getByTestId('hockia-ai-context-chip').className).toContain('self-start')
    expect(screen.getAllByTestId('hockia-ai-option')).toHaveLength(3)
    expect(screen.getByTestId('hockia-ai-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('hockia-ai-home')).toBeNull()
  })

  it('Escape closes it', () => {
    useHockiaAiSheet.setState({ open: true, detent: 'medium', mode: 'chat', roleContext: null, seed: null })
    render(<MemoryRouter><HockiaAiSheet /></MemoryRouter>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useHockiaAiSheet.getState().open).toBe(false)
  })
})

describe('Hockia AI side panel closing (design review 2026-11-06)', () => {
  it('slides out before it unmounts', async () => {
    const { GlobalHockiaAiSheet } = await import('@/components/hockiaAi/GlobalHockiaAiSheet')
    const { act, waitFor } = await import('@testing-library/react')
    useHockiaAiSheet.setState({ open: true, detent: 'medium', mode: 'chat', roleContext: null, seed: null })
    render(<MemoryRouter><GlobalHockiaAiSheet /></MemoryRouter>)
    expect(await screen.findByTestId('hockia-ai-sheet')).toBeInTheDocument()
    act(() => { useHockiaAiSheet.getState().close() })
    // Still there, sliding out…
    expect(screen.getByTestId('hockia-ai-sheet').style.opacity).toBe('0')
    // …then gone.
    await waitFor(() => expect(screen.queryByTestId('hockia-ai-sheet')).toBeNull(), { timeout: 1000 })
  })
})
