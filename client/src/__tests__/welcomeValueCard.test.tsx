import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import WelcomeValueCard from '@/components/WelcomeValueCard'

// Pins the user-scoped dismissal contract so a future regression to a
// global key (the original v1 bug — one user dismissing hid the card
// for everyone on the same browser) surfaces in CI.

const authState: { user: { id: string } | null } = { user: null }

vi.mock('@/lib/auth', () => ({
  useAuthStore: <T,>(selector?: (state: { user: { id: string } | null }) => T) =>
    selector ? selector(authState) : authState,
}))

describe('WelcomeValueCard — user-scoped dismissal', () => {
  beforeEach(() => {
    window.localStorage.clear()
    authState.user = null
  })

  it('does not render when no user is signed in', () => {
    authState.user = null
    const { container } = render(<WelcomeValueCard />)
    expect(container.textContent ?? '').toBe('')
  })

  it('renders the welcome copy for a signed-in user with no dismissal', () => {
    authState.user = { id: 'user-a' }
    render(<WelcomeValueCard />)
    expect(screen.getByText(/Welcome to HOCKIA/i)).toBeTruthy()
  })

  it('persists dismissal to a user-scoped localStorage key', () => {
    authState.user = { id: 'user-a' }
    render(<WelcomeValueCard />)
    fireEvent.click(screen.getByLabelText(/dismiss welcome/i))

    // Expected key shape: `<prefix>:<userId>`. The unscoped global key
    // (the bug we fixed) would be without the userId suffix.
    const key = `hockia-welcome-card-dismissed-v1:user-a`
    expect(window.localStorage.getItem(key)).toBe('true')
  })

  it('user A dismissing does NOT hide the card for user B on the same browser', () => {
    // User A dismisses
    authState.user = { id: 'user-a' }
    const { unmount } = render(<WelcomeValueCard />)
    fireEvent.click(screen.getByLabelText(/dismiss welcome/i))
    unmount()

    // User B signs in (same browser, same localStorage)
    authState.user = { id: 'user-b' }
    render(<WelcomeValueCard />)
    // User B should still see the welcome — the global-key bug would
    // hide it for them too.
    expect(screen.getByText(/Welcome to HOCKIA/i)).toBeTruthy()
  })
})
