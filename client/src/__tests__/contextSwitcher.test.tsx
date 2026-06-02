/**
 * ContextSwitcher — render gates + Reset-button visibility.
 *
 * What we lock in:
 *   - Hides entirely for non-recruiter viewers (player / brand /
 *     umpire / anon) — never renders a chip
 *   - Renders the "Set recruiting context →" empty-state CTA for an
 *     eligible viewer with no active context (typical coach)
 *   - Renders the active context label for a viewer with one
 *   - Reset button visibility:
 *       * hidden when active === default
 *       * hidden when no default exists (coaches)
 *       * visible when active is opportunity / custom AND a default
 *         club row exists in `available`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── Hoisted supabase mock (modules import it at load) ───────────────
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  const chain = vi.fn(() => builder)
  builder.select = chain
  builder.eq = chain
  builder.neq = chain
  builder.order = chain
  builder.update = chain
  builder.insert = chain
  builder.delete = chain
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
  // PostgrestBuilder is thenable; resolve to empty rows so any
  // accidental fetch during a test returns harmlessly.
  ;(builder as { then: (r: (v: unknown) => unknown) => Promise<unknown> }).then = (r) =>
    Promise.resolve({ data: [], error: null }).then(r)
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    },
    AUTH_STORAGE_KEY: 'hockia-auth',
    SUPABASE_URL: 'https://test.local',
    SUPABASE_ANON_KEY: 'test',
  }
})

vi.mock('@/lib/sentryHelpers', () => ({
  reportSupabaseError: vi.fn(),
}))

// Hoisted auth state — mutated by setAuthRole() helper per-test
const authState = vi.hoisted(() => ({
  profile: null as { id: string; role: string } | null,
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

import { useRecruitingContextStore, type RecruitingContextRow } from '@/hooks/useRecruitingContext'
import ContextSwitcher from '@/components/recruiting/ContextSwitcher'

const OWNER = 'owner-1'

function buildRow(overrides: Partial<RecruitingContextRow>): RecruitingContextRow {
  return {
    id: 'row-default',
    owner_id: OWNER,
    type: 'club',
    is_active: true,
    target_category: 'Mixed',
    target_role: null,
    target_position: null,
    eu_required: false,
    competition_id: null,
    region: null,
    opportunity_id: null,
    label: 'Club default',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setAuthRole(role: 'club' | 'coach' | 'player' | 'brand' | 'umpire' | null) {
  authState.profile = role ? { id: OWNER, role } : null
}

/** Plant state directly so the chip's loading guard doesn't return
 *  null. We set `loading: false` + `fetchedForOwner: OWNER` to
 *  simulate "fetch already completed for this viewer". */
function plantStore(rows: RecruitingContextRow[]) {
  useRecruitingContextStore.setState({
    ownerId: OWNER,
    eligibleRole: 'club',
    rows,
    loading: false,
    error: null,
    fetchedForOwner: OWNER,
  })
}

beforeEach(() => {
  setAuthRole(null)
  useRecruitingContextStore.setState({
    ownerId: null,
    eligibleRole: null,
    rows: [],
    loading: false,
    error: null,
    fetchedForOwner: null,
  })
})

// ── Role gate ───────────────────────────────────────────────────────
describe('ContextSwitcher render gate', () => {
  it.each(['player', 'brand', 'umpire'] as const)(
    'hides entirely for %s viewers',
    (role) => {
      setAuthRole(role)
      plantStore([buildRow({})])
      // Override eligibleRole since plantStore set it to 'club'.
      useRecruitingContextStore.setState({ eligibleRole: null })

      const { container } = render(<ContextSwitcher />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('hides for anonymous viewers (no profile)', () => {
    setAuthRole(null)
    const { container } = render(<ContextSwitcher />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an invisible height placeholder during initial load (loading=true, no active)', () => {
    setAuthRole('club')
    // fetchedForOwner=OWNER so ensureFetched short-circuits — keeps
    // the test deterministic and avoids spurious act() warnings from
    // the trailing fetch that would never produce visible output.
    useRecruitingContextStore.setState({
      ownerId: OWNER,
      eligibleRole: 'club',
      rows: [],
      loading: true,
      fetchedForOwner: OWNER,
    })
    const { container } = render(<ContextSwitcher />)
    // F4 fix: instead of returning null (which caused a 2-3s layout
    // gap above the Community tabs on cold load), the chip now renders
    // an aria-hidden placeholder reserving its height. No visible
    // chrome, no Target icon, no chip text — just empty inline-flex.
    expect(container.textContent).toBe('')
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

// ── Empty state ─────────────────────────────────────────────────────
describe('empty state CTA', () => {
  it('coach with no contexts → renders Club-Fit-enabling CTA (no "optional" label)', () => {
    // Coaches have no profile-derived target source, so a context is
    // REQUIRED for Club Fit to render — the empty-state copy should
    // reflect that instead of the old generic "(optional)" label.
    setAuthRole('coach')
    useRecruitingContextStore.setState({
      ownerId: OWNER,
      eligibleRole: 'coach',
      rows: [],
      loading: false,
      fetchedForOwner: OWNER,
    })
    render(<ContextSwitcher />)
    expect(screen.getByText(/set scope to enable club fit/i)).toBeInTheDocument()
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument()
  })

  it('club with no contexts → keeps "(optional)" because profile-derived target still works', () => {
    setAuthRole('club')
    useRecruitingContextStore.setState({
      ownerId: OWNER,
      eligibleRole: 'club',
      rows: [],
      loading: false,
      fetchedForOwner: OWNER,
    })
    render(<ContextSwitcher />)
    expect(screen.getByText(/add recruiting context/i)).toBeInTheDocument()
    expect(screen.getByText(/optional/i)).toBeInTheDocument()
  })
})

// ── Active context label ───────────────────────────────────────────
describe('active context label', () => {
  it('renders the active row label', () => {
    setAuthRole('club')
    plantStore([buildRow({ label: 'Club default · Mixed · Buenos Aires' })])
    render(<ContextSwitcher />)
    expect(screen.getByText('Club default · Mixed · Buenos Aires')).toBeInTheDocument()
  })

  it('falls back to "target · region" when label is empty', () => {
    setAuthRole('club')
    plantStore([
      buildRow({
        label: null,
        target_category: 'Women',
        region: 'Madrid',
      }),
    ])
    render(<ContextSwitcher />)
    expect(screen.getByText('Women · Madrid')).toBeInTheDocument()
  })
})

// ── Clear button visibility (Sprint 4: replaces Reset) ────────────
// The Reset-to-default concept was removed when auto-seeded
// type='club' rows were deleted from prod. The chip now exposes a
// simple Clear (X) whenever there's ANY active context, which
// deactivates without picking another row.
describe('Clear button visibility', () => {
  it('hidden when there is no active context', () => {
    setAuthRole('coach')
    useRecruitingContextStore.setState({
      ownerId: OWNER,
      eligibleRole: 'coach',
      rows: [],
      loading: false,
      fetchedForOwner: OWNER,
    })
    render(<ContextSwitcher />)
    expect(screen.queryByLabelText(/clear active recruiting context/i)).not.toBeInTheDocument()
  })

  it('visible when active=custom (any active context can be cleared)', () => {
    setAuthRole('club')
    plantStore([
      buildRow({
        id: 'custom-ctx',
        type: 'custom',
        target_category: 'Women',
        label: 'Women — next season',
        is_active: true,
      }),
    ])
    render(<ContextSwitcher />)
    expect(screen.getByLabelText(/clear active recruiting context/i)).toBeInTheDocument()
  })

  it('visible when active=opportunity', () => {
    setAuthRole('club')
    plantStore([
      buildRow({
        id: 'opp-ctx',
        type: 'opportunity',
        target_category: 'Women',
        opportunity_id: 'opp-1',
        label: 'Women — Goalkeeper hire',
        is_active: true,
      }),
    ])
    render(<ContextSwitcher />)
    expect(screen.getByLabelText(/clear active recruiting context/i)).toBeInTheDocument()
  })
})
