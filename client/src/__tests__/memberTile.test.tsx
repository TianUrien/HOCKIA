/**
 * MemberTile — Community card render + role-coverage tests.
 *
 * Focus: visual regressions from the circular-avatar redesign.
 *   - all 5 roles render their headline pill + role-native row
 *   - dual-nationality + EU pill render together
 *   - long names truncate without breaking layout
 *   - missing data falls back to RolePlaceholder, not a broken image
 *   - clicking a tile (no preview prop) gates unauth users behind
 *     the sign-in modal and routes auth users to the right URL
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// ── Hoisted mocks ──────────────────────────────────────────────────

// MemberTile imports `{ RoleBadge, TierBadge, ... }` from the @/components
// barrel, which transitively loads modules that import @/lib/supabase.
// In CI (no .env.local) the supabase module throws at load-time on missing
// env vars, taking the whole test file with it. This stub lets the module
// load without exercising any real Supabase API. MemberTile itself doesn't
// call supabase, so an inert builder is enough.
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  const chain = vi.fn(() => builder)
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.in = chain
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
    AUTH_STORAGE_KEY: 'hockia-auth',
    SUPABASE_URL: 'https://test.supabase.local',
    SUPABASE_ANON_KEY: 'test-anon-key',
  }
})

const navigateMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({
  user: { id: 'viewer-1' } as { id: string } | null,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/hooks/useWorldClubLogo', () => ({
  useWorldClubLogo: () => null,
}))

vi.mock('@/lib/imageUrl', () => ({
  getImageUrl: (src: string) => src,
}))

// useCountries is consumed by DualNationalityDisplay. Map a small fixture
// covering one EU country (NL=10), one non-EU (AR=20), and one EU (FR=30).
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: [],
    loading: false,
    error: null,
    getCountryById: (id: number | null) => {
      if (id === 10)
        return {
          id: 10,
          code: 'nl',
          code_alpha3: 'NLD',
          name: 'Netherlands',
          common_name: null,
          nationality_name: 'Dutch',
          region: 'Europe',
          flag_emoji: '🇳🇱',
        }
      if (id === 20)
        return {
          id: 20,
          code: 'ar',
          code_alpha3: 'ARG',
          name: 'Argentina',
          common_name: null,
          nationality_name: 'Argentinian',
          region: 'Americas',
          flag_emoji: '🇦🇷',
        }
      if (id === 30)
        return {
          id: 30,
          code: 'fr',
          code_alpha3: 'FRA',
          name: 'France',
          common_name: null,
          nationality_name: 'French',
          region: 'Europe',
          flag_emoji: '🇫🇷',
        }
      return undefined
    },
    getCountryByCode: () => undefined,
    isEuCountry: (id: number | null) => id === 10 || id === 30,
  }),
}))

// SignInPromptModal renders a Modal with Buttons — stub to a simple flag
// so we can assert it shows without pulling in the full Modal.
vi.mock('@/components/SignInPromptModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="sign-in-prompt" /> : null,
}))

// ── Now import the component under test ────────────────────────────

import MemberTile from '@/components/MemberTile'

// ── Helpers ────────────────────────────────────────────────────────

type Role = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

function renderTile(overrides: Partial<React.ComponentProps<typeof MemberTile>> = {}) {
  const defaults: React.ComponentProps<typeof MemberTile> = {
    id: 'm-1',
    avatar_url: null,
    full_name: 'Alex Player',
    role: 'player',
    nationality: 'Dutch',
    nationality_country_id: 10,
    nationality2_country_id: null,
    base_location: 'Amsterdam',
    current_team: null,
  }
  return render(
    <MemoryRouter>
      <MemberTile {...defaults} {...overrides} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { id: 'viewer-1' }
})

// ── Role coverage — each role renders correctly ────────────────────

describe('MemberTile — role coverage', () => {
  const roles: Role[] = ['player', 'coach', 'club', 'brand', 'umpire']

  it.each(roles)('renders without crashing for role: %s', (role) => {
    renderTile({ role, full_name: `Test ${role}` })
    expect(screen.getByText(`Test ${role}`)).toBeInTheDocument()
  })

  it('player tile shows current_team when provided', () => {
    renderTile({
      role: 'player',
      current_team: 'HC Bloemendaal',
      base_location: 'Amsterdam',
    })
    expect(screen.getByText('HC Bloemendaal')).toBeInTheDocument()
  })

  it('player tile falls back to base_location when no current_team', () => {
    renderTile({
      role: 'player',
      current_team: null,
      base_location: 'Amsterdam',
    })
    expect(screen.getByText('Amsterdam')).toBeInTheDocument()
  })

  it('coach tile shows current_team', () => {
    renderTile({
      role: 'coach',
      full_name: 'Maria Coach',
      current_team: 'Den Bosch',
    })
    expect(screen.getByText('Den Bosch')).toBeInTheDocument()
  })

  it('club tile shows base_location', () => {
    renderTile({
      role: 'club',
      full_name: 'HC Rotterdam',
      base_location: 'Rotterdam, NL',
    })
    expect(screen.getByText('Rotterdam, NL')).toBeInTheDocument()
  })

  it('brand tile shows category label (mapped from internal slug)', () => {
    renderTile({
      role: 'brand',
      full_name: 'Pro Stick Co.',
      brandCategory: 'equipment',
    })
    expect(screen.getByText('Equipment')).toBeInTheDocument()
  })

  it('brand tile renders raw category when not in label map', () => {
    renderTile({
      role: 'brand',
      full_name: 'Brand X',
      brandCategory: 'unknown-cat',
    })
    expect(screen.getByText('unknown-cat')).toBeInTheDocument()
  })

  it('umpire tile shows federation when provided', () => {
    renderTile({
      role: 'umpire',
      full_name: 'Sara Umpire',
      federation: 'KNHB',
    })
    expect(screen.getByText('KNHB')).toBeInTheDocument()
  })

  it('umpire tile shows umpire level pill when provided', () => {
    renderTile({
      role: 'umpire',
      full_name: 'Sara Umpire',
      umpireLevel: 'FIH Pro',
    })
    expect(screen.getByText('FIH Pro')).toBeInTheDocument()
  })

  it('umpire tile falls back to base_location when no federation', () => {
    renderTile({
      role: 'umpire',
      full_name: 'Sara Umpire',
      federation: null,
      base_location: 'Utrecht',
    })
    expect(screen.getByText('Utrecht')).toBeInTheDocument()
  })
})

// ── Nationality + EU rendering ─────────────────────────────────────

describe('MemberTile — nationality display', () => {
  it('shows single nationality name (no EU pill for non-EU)', () => {
    renderTile({
      nationality_country_id: 20, // Argentina
      nationality2_country_id: null,
    })
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
    expect(screen.queryByText('EU')).not.toBeInTheDocument()
  })

  it('shows single nationality + EU pill when nationality is EU', () => {
    renderTile({
      nationality_country_id: 10, // Netherlands
      nationality2_country_id: null,
    })
    expect(screen.getByText('Dutch')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('shows BOTH nationality names for dual nationality', () => {
    renderTile({
      nationality_country_id: 20, // Argentina
      nationality2_country_id: 10, // Netherlands → triggers EU
    })
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
    expect(screen.getByText('Dutch')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('shows EU pill when only secondary is EU', () => {
    renderTile({
      nationality_country_id: 20, // non-EU
      nationality2_country_id: 30, // EU
    })
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('falls back to plain text when no country IDs but nationality string present', () => {
    renderTile({
      nationality: 'Some Nationality',
      nationality_country_id: null,
      nationality2_country_id: null,
    })
    expect(screen.getByText('Some Nationality')).toBeInTheDocument()
  })

  it('omits nationality row entirely when both ID and string are missing', () => {
    renderTile({
      nationality: null,
      nationality_country_id: null,
      nationality2_country_id: null,
    })
    // Name still renders but nothing in the nationality slot
    expect(screen.getByText('Alex Player')).toBeInTheDocument()
    expect(screen.queryByText('EU')).not.toBeInTheDocument()
  })
})

// ── Layout robustness — long names + missing data ──────────────────

describe('MemberTile — layout robustness', () => {
  it('long names truncate without overflow (truncate class applied)', () => {
    const longName = 'Maximiliano Wolfgang von Schmittenburger-Hamilton III'
    renderTile({ full_name: longName })
    const heading = screen.getByText(longName)
    // h3 carries truncate min-w-0 so the row stays inside the tile
    expect(heading.className).toContain('truncate')
    expect(heading.className).toContain('min-w-0')
  })

  it('renders RolePlaceholder SVG when no avatar_url provided', () => {
    const { container } = renderTile({ avatar_url: null })
    // RolePlaceholder is the SVG fallback
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('renders <img> when avatar_url provided', () => {
    const { container } = renderTile({ avatar_url: 'https://example.com/a.png' })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toContain('a.png')
  })

  it('brand tile prefers brandLogoUrl over avatar_url', () => {
    const { container } = renderTile({
      role: 'brand',
      avatar_url: 'https://example.com/avatar.png',
      brandLogoUrl: 'https://example.com/logo.png',
    })
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('logo.png')
  })

  it('shows green dot when player is open_to_play', () => {
    renderTile({ role: 'player', open_to_play: true })
    expect(screen.getByLabelText('Open to opportunities')).toBeInTheDocument()
  })

  it('shows green dot when coach is open_to_coach', () => {
    renderTile({ role: 'coach', open_to_coach: true })
    expect(screen.getByLabelText('Open to opportunities')).toBeInTheDocument()
  })

  it('hides green dot when player is not open_to_play', () => {
    renderTile({ role: 'player', open_to_play: false })
    expect(screen.queryByLabelText('Open to opportunities')).not.toBeInTheDocument()
  })

  it('renders verified badge when isVerified=true', () => {
    renderTile({ isVerified: true, verifiedAt: '2026-01-01T00:00:00Z' })
    expect(screen.getByLabelText('Verified profile')).toBeInTheDocument()
  })

  it('hides verified badge when isVerified=false', () => {
    renderTile({ isVerified: false })
    expect(screen.queryByLabelText('Verified profile')).not.toBeInTheDocument()
  })
})

// ── Click behavior — auth gating + role-based routing ──────────────

describe('MemberTile — click behavior', () => {
  it('calls onPreview when provided (preview takes precedence)', async () => {
    const onPreview = vi.fn()
    renderTile({ onPreview })
    await userEvent.click(screen.getByRole('button', { name: /Alex Player/i }))
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows sign-in prompt for unauthenticated users (no preview prop)', async () => {
    authState.user = null
    renderTile({})
    await userEvent.click(screen.getByRole('button', { name: /Alex Player/i }))
    expect(screen.getByTestId('sign-in-prompt')).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('navigates auth player to /players/id/:id', async () => {
    renderTile({ id: 'pid-1', role: 'player' })
    await userEvent.click(screen.getByRole('button', { name: /Alex Player/i }))
    expect(navigateMock).toHaveBeenCalledWith('/players/id/pid-1?ref=community')
  })

  it('navigates auth club to /clubs/id/:id', async () => {
    renderTile({ id: 'cid-1', role: 'club', full_name: 'HC X' })
    await userEvent.click(screen.getByRole('button', { name: /HC X/i }))
    expect(navigateMock).toHaveBeenCalledWith('/clubs/id/cid-1?ref=community')
  })

  it('navigates auth umpire to /umpires/id/:id', async () => {
    renderTile({ id: 'uid-1', role: 'umpire', full_name: 'Sara U' })
    await userEvent.click(screen.getByRole('button', { name: /Sara U/i }))
    expect(navigateMock).toHaveBeenCalledWith('/umpires/id/uid-1?ref=community')
  })

  it('navigates auth brand with slug to /brands/:slug', async () => {
    renderTile({ id: 'bid-1', role: 'brand', full_name: 'Pro X', brandSlug: 'pro-x' })
    await userEvent.click(screen.getByRole('button', { name: /Pro X/i }))
    expect(navigateMock).toHaveBeenCalledWith('/brands/pro-x?ref=community')
  })

  it('navigates auth brand without slug to /marketplace', async () => {
    renderTile({ id: 'bid-1', role: 'brand', full_name: 'Pro X', brandSlug: null })
    await userEvent.click(screen.getByRole('button', { name: /Pro X/i }))
    expect(navigateMock).toHaveBeenCalledWith('/marketplace')
  })
})
