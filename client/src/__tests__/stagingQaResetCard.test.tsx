/**
 * StagingQaResetCard — env-gate contract.
 *
 * Pins the single guarantee that matters here: this component renders nothing
 * unless VITE_ENVIRONMENT === 'staging'. The DB-side RPC has its own gate, but
 * the frontend gate is the first line of defence — if it leaked into a prod
 * build the button would still call into a function that errors, but it
 * shouldn't be reachable at all.
 */

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { signOut: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

import StagingQaResetCard from '@/components/StagingQaResetCard'

const renderCard = () =>
  render(
    <MemoryRouter>
      <StagingQaResetCard />
    </MemoryRouter>,
  )

describe('StagingQaResetCard env gate', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = import.meta.env.VITE_ENVIRONMENT
  })

  afterEach(() => {
    // Restore — important so other tests don't pick up our mutation
    import.meta.env.VITE_ENVIRONMENT = originalEnv
  })

  it('renders nothing in production (VITE_ENVIRONMENT unset)', () => {
    import.meta.env.VITE_ENVIRONMENT = undefined
    const { container } = renderCard()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when VITE_ENVIRONMENT="production"', () => {
    import.meta.env.VITE_ENVIRONMENT = 'production'
    const { container } = renderCard()
    expect(container.firstChild).toBeNull()
  })

  it('renders the reset card when VITE_ENVIRONMENT="staging"', () => {
    import.meta.env.VITE_ENVIRONMENT = 'staging'
    renderCard()
    expect(screen.getByText('Staging QA tools')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset my onboarding/i })).toBeInTheDocument()
  })

  it('shows the Gmail-alias hint in the staging card', () => {
    import.meta.env.VITE_ENVIRONMENT = 'staging'
    renderCard()
    expect(screen.getByText(/playrplayer93\+test01@gmail\.com/i)).toBeInTheDocument()
  })
})
