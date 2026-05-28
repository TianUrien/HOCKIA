/**
 * CoachContextNudge — visibility + dismissal contract.
 *
 * Locks in:
 *   - Renders for coaches with no active context (the value gap path).
 *   - Hidden for non-coach roles (clubs derive Fit from profile; others
 *     don't get Fit at all).
 *   - Hidden when an active context exists (the gap is closed).
 *   - Hidden while the context fetch is in flight (no flicker).
 *   - Dismiss × persists to localStorage and the banner stays hidden
 *     on remount.
 *
 * ContextEditSheet is stubbed — its own tests cover the picker flow;
 * here we only care that the nudge mounts the sheet trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Inert supabase — none of the nudge's gating paths fetch.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}))

// Per-test mutable auth state.
const authState: { profile: { id: string; role: string } | null } = { profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

// Per-test mutable context state. Mirrors the shape useRecruitingContext returns.
type ActiveCtx = { id: string; label: string | null; target_category: string | null; region: string | null } | null
const ctxState: { active: ActiveCtx; loading: boolean } = { active: null, loading: false }
vi.mock('@/hooks/useRecruitingContext', () => ({
  useRecruitingContext: () => ({
    active: ctxState.active,
    loading: ctxState.loading,
  }),
}))

// Stub ContextEditSheet — we only need to assert it mounts when the
// "Set scope" button is clicked.
vi.mock('@/components/recruiting/ContextEditSheet', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="context-edit-sheet" /> : null,
}))

import CoachContextNudge from '@/components/recruiting/CoachContextNudge'

const DISMISS_KEY = 'hockia.coach-context-nudge-dismissed'

function setCoach() {
  authState.profile = { id: 'coach-1', role: 'coach' }
}
function setClub() {
  authState.profile = { id: 'club-1', role: 'club' }
}
function setAnon() {
  authState.profile = null
}
function setContext(active: ActiveCtx, loading = false) {
  ctxState.active = active
  ctxState.loading = loading
}

describe('CoachContextNudge', () => {
  beforeEach(() => {
    setAnon()
    setContext(null)
    window.localStorage.removeItem(DISMISS_KEY)
    cleanup()
  })

  it('renders for coach viewer with no active context', () => {
    setCoach()
    render(<CoachContextNudge />)
    expect(screen.getByTestId('coach-context-nudge')).toBeInTheDocument()
    expect(screen.getByText(/unlock club fit on every player/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set scope/i })).toBeInTheDocument()
  })

  it('hidden for club viewer (their Fit derives from profile)', () => {
    setClub()
    const { container } = render(<CoachContextNudge />)
    expect(container.firstChild).toBeNull()
  })

  it('hidden for anonymous viewer', () => {
    setAnon()
    const { container } = render(<CoachContextNudge />)
    expect(container.firstChild).toBeNull()
  })

  it('hidden when an active recruiting context exists', () => {
    setCoach()
    setContext({ id: 'ctx-1', label: "Women's pre-season", target_category: 'Women', region: null })
    const { container } = render(<CoachContextNudge />)
    expect(container.firstChild).toBeNull()
  })

  it('hidden while the context fetch is in flight', () => {
    setCoach()
    setContext(null, true)
    const { container } = render(<CoachContextNudge />)
    expect(container.firstChild).toBeNull()
  })

  it('clicking "Set scope" opens the ContextEditSheet', async () => {
    setCoach()
    render(<CoachContextNudge />)
    await userEvent.click(screen.getByRole('button', { name: /set scope/i }))
    expect(screen.getByTestId('context-edit-sheet')).toBeInTheDocument()
  })

  it('dismiss button persists to localStorage and hides the banner on remount', async () => {
    setCoach()
    const first = render(<CoachContextNudge />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss club fit hint/i }))
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe('1')
    // Banner self-hides immediately.
    expect(screen.queryByTestId('coach-context-nudge')).not.toBeInTheDocument()

    first.unmount()
    cleanup()
    // Fresh mount with localStorage flag set — still hidden.
    render(<CoachContextNudge />)
    expect(screen.queryByTestId('coach-context-nudge')).not.toBeInTheDocument()
  })
})
