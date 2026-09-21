import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

// Mock dependencies before imports
vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }),
  },
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  // Stubbed to satisfy react-router internals used by Link / nested components.
  // Filter persistence itself moved off usePageState (which reads these) onto
  // usePersistedState (localStorage), so these stubs are no longer load-bearing
  // for the filter behavior — kept just to avoid undefined-method errors.
  useLocation: () => ({ key: 'test', pathname: '/home', search: '', hash: '', state: null }),
  useNavigationType: () => 'PUSH',
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

// HomeFilterChips reads the countries list. Stub with an empty list so the
// chips render the "All countries / All roles" baseline (sufficient for the
// empty-state test).
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: [],
    loading: false,
    error: null,
    getCountryById: () => undefined,
    getCountryByCode: () => undefined,
    isEuCountry: () => false,
  }),
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({
    user: null,
    profile: null,
  }),
}))

vi.mock('@/hooks/useHomeFeed', () => ({
  useHomeFeed: () => ({
    items: [],
    isLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    updateItemLike: vi.fn(),
    removeItem: vi.fn(),
    prependItem: vi.fn(),
  }),
}))

vi.mock('@/components/home/PostComposer', () => ({
  PostComposer: () => null,
}))

vi.mock('@/components/home/FeedSkeleton', () => ({
  FeedSkeleton: () => <div data-testid="skeleton" />,
}))

import { HomeFeed } from '@/components/home/HomeFeed'

describe('HomeFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows empty state when no items and not loading', () => {
    render(<HomeFeed />)

    expect(screen.getByText('Welcome to your feed')).toBeInTheDocument()
    expect(screen.getByText('Browse Opportunities')).toBeInTheDocument()
    expect(screen.getByText('Join the Community')).toBeInTheDocument()
    expect(screen.getByText('Explore Clubs')).toBeInTheDocument()
    expect(screen.getByText('Find People')).toBeInTheDocument()
  })
})
