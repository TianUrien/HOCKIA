import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ProtectedRoute's auth-hydration gate (part of the 2026-08-17 launch-flicker
 * fix): while the auth store is still `loading`, no route renders. What fills
 * that window differs by platform:
 *
 *   NATIVE → NativeLaunchSplash (violet + white mark), pixel-matched to the
 *            system launch screen, so a cold launch is ONE uninterrupted
 *            splash — never the old gray "Loading..." spinner sandwiched
 *            between the violet system splash and the app.
 *   WEB    → the gray spinner, unchanged (existing site behavior).
 *
 * IS_NATIVE is a module constant, so each case isolates modules and re-mocks.
 */

const h = vi.hoisted(() => ({
  state: { user: null as null | object, profile: null as null | object, loading: true },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))

async function mountHydrating(isNative: boolean) {
  vi.resetModules()
  vi.doMock('@/lib/isNative', () => ({ IS_NATIVE: isNative }))
  const { default: ProtectedRoute } = await import('@/components/ProtectedRoute')
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ProtectedRoute>
        <div data-testid="content">route content</div>
      </ProtectedRoute>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute — auth hydrating (loading: true)', () => {
  beforeEach(() => {
    h.state.user = null
    h.state.profile = null
    h.state.loading = true
  })

  it('NATIVE: continues the launch splash — no gray spinner, no route content', async () => {
    await mountHydrating(true)
    expect(screen.getByTestId('native-launch-splash')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('WEB: keeps the existing gray spinner — the splash is native-only', async () => {
    await mountHydrating(false)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('native-launch-splash')).toBeNull()
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('NATIVE: once hydration resolves, the gate opens and the route renders', async () => {
    h.state.loading = false
    await mountHydrating(true)
    expect(screen.getByTestId('content')).toBeInTheDocument()
    expect(screen.queryByTestId('native-launch-splash')).toBeNull()
  })
})
