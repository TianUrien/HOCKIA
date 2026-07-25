import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 1: the login-wall → registration funnel. The wall is the single
// chokepoint (login_wall_shown), and a wall intent bridges to
// registration_from_wall if the visitor registers soon after.

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}))
vi.mock('@/lib/analyticsIdentity', () => ({
  analyticsContext: () => ({
    session_id: 's', anonymous_id: 'a', device: 'desktop', browser: 'chrome', referrer_source: 'direct',
  }),
  getFirstTouch: () => null,
}))

import { markWallIntent, consumeWallIntent } from '@/lib/trackDbEvent'

beforeEach(() => {
  sessionStorage.clear()
  vi.useRealTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('wall intent bridge', () => {
  it('round-trips once then clears', () => {
    markWallIntent('apply_opportunity')
    expect(consumeWallIntent()).toBe('apply_opportunity')
    expect(consumeWallIntent()).toBeNull() // single-use
  })

  it('ignores stale intent older than an hour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
    markWallIntent('message')
    vi.setSystemTime(new Date(2026, 0, 1, 13, 1, 0)) // +61 min
    expect(consumeWallIntent()).toBeNull()
  })

  it('returns null when nothing was marked', () => {
    expect(consumeWallIntent()).toBeNull()
  })
})

describe('SignInPromptModal instrumentation', () => {
  it('fires login_wall_shown once on open with the action, and marks intent on CTA', async () => {
    const trackDbEvent = vi.fn()
    const markWall = vi.fn()
    vi.doMock('@/lib/trackDbEvent', () => ({ trackDbEvent, markWallIntent: markWall }))
    vi.doMock('@/lib/analytics', () => ({ trackSignupWallAction: vi.fn() }))
    const { default: SignInPromptModal } = await import('@/components/SignInPromptModal')

    const { rerender } = render(
      <MemoryRouter>
        <SignInPromptModal isOpen={false} onClose={vi.fn()} action="apply_opportunity" />
      </MemoryRouter>,
    )
    expect(trackDbEvent).not.toHaveBeenCalled()

    rerender(
      <MemoryRouter>
        <SignInPromptModal isOpen onClose={vi.fn()} action="apply_opportunity" />
      </MemoryRouter>,
    )
    expect(trackDbEvent).toHaveBeenCalledWith('login_wall_shown', undefined, undefined, {
      action: 'apply_opportunity',
    })
    expect(trackDbEvent).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText(/Create Free Account/i))
    expect(markWall).toHaveBeenCalledWith('apply_opportunity')

    vi.doUnmock('@/lib/trackDbEvent')
    vi.doUnmock('@/lib/analytics')
  })
})
