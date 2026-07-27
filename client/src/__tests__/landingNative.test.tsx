import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The landing page renders on BOTH the website and inside the native app
 * (it's the first screen a logged-out app user sees). The store badges are
 * correct on the web and dead weight in the app — the visitor demonstrably
 * already installed it — so they are web-only.
 *
 * The website must stay byte-identical; these tests pin both sides.
 */

const native = vi.hoisted(() => ({ value: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}))

// Keep the page cheap to mount — we're asserting one conditional block.
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: null, profile: null, profileStatus: 'missing', loading: false }
    return typeof sel === 'function' ? sel(state) : state
  },
}))
vi.mock('@/lib/contact', () => ({ useContactModal: () => vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackSignupCtaClick: vi.fn() }))
vi.mock('@/lib/nativeUi', () => ({ setStatusBarForBackground: vi.fn() }))
vi.mock('@/components', () => ({
  InAppBrowserWarning: () => null,
  PublicNav: () => <nav data-testid="public-nav" />,
}))
vi.mock('@/components/HockiaSocials', () => ({ default: () => <div /> }))
vi.mock('@/components/StoreBadges', () => ({
  default: () => <div data-testid="store-badges">badges</div>,
}))

async function renderLanding() {
  vi.resetModules()
  const { default: Landing } = await import('@/pages/Landing')
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

afterEach(() => {
  native.value = false
  vi.clearAllMocks()
})

describe('Landing — store badges are web-only', () => {
  it('SHOWS the badges and the download copy on the website', async () => {
    native.value = false
    await renderLanding()
    expect(screen.getByTestId('store-badges')).toBeInTheDocument()
    expect(screen.getByText(/Use HOCKIA on the web/i)).toBeInTheDocument()
  })

  it('HIDES the badges and the download copy inside the native app', async () => {
    native.value = true
    await renderLanding()
    expect(screen.queryByTestId('store-badges')).not.toBeInTheDocument()
    expect(screen.queryByText(/Use HOCKIA on the web/i)).not.toBeInTheDocument()
  })

  it('keeps BOTH primary CTAs in the app — only the download block is removed', async () => {
    native.value = true
    await renderLanding()
    expect(screen.getAllByRole('link', { name: /explore hockia/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /create your profile/i }).length).toBeGreaterThan(0)
  })
})
