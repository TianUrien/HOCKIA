/**
 * A role with a signing can't be deleted (founder ruling 2026-10-09).
 * - Desktop Opportunities tab: "Delete permanently" is disabled on a closed role
 *   with a signed / waiting-to-confirm application, with the founder sentence.
 * - A delete the server refuses (P0001 from the BEFORE DELETE trigger) shows the
 *   same sentence instead of the generic failure, and the row stays.
 * - The phone Club v2 role menu offers no delete at all.
 */
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { vi } from 'vitest'
import {
  isRoleHasSigningError,
  ROLE_HAS_SIGNING_MESSAGE,
  SIGNING_LOCK_STATUSES,
} from '@/lib/roleLifecycle'

const fx = vi.hoisted(() => ({
  roles: [] as Record<string, unknown>[],
  signingRows: [] as { opportunity_id: string }[],
  signingQuery: [] as unknown[][],
  deleteError: null as null | { code: string; message: string },
  deleted: [] as string[],
}))

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    let op: 'select' | 'delete' = 'select'
    const inArgs: unknown[][] = []
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.update = () => chain
    chain.or = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.delete = () => {
      op = 'delete'
      return chain
    }
    chain.in = (...args: unknown[]) => {
      inArgs.push(args)
      return chain
    }
    chain.eq = (_col: string, val: unknown) => {
      if (op === 'delete' && table === 'opportunities') {
        fx.deleted.push(String(val))
        return Promise.resolve({ data: null, error: fx.deleteError })
      }
      return chain
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.single = () => Promise.resolve({ data: null, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (table === 'opportunity_applications' && inArgs.length === 2) {
        fx.signingQuery = inArgs
        return Promise.resolve({ data: fx.signingRows, error: null }).then(res, rej)
      }
      return Promise.resolve({ data: [], error: null }).then(res, rej)
    }
    return chain
  }
  return {
    SUPABASE_URL: 'https://supabase.test',
    supabase: {
      from: (t: string) => builder(t),
      rpc: (fn: string) => ({
        returns: () => Promise.resolve({ data: fn === 'fetch_club_opportunities_with_counts' ? fx.roles : [], error: null }),
      }),
    },
  }
})

// Stable identity: OpportunitiesTab refetches when `user` changes.
const authState = vi.hoisted(() => ({ user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club' }, refreshProfile: () => undefined }))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => authState }))
const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast }) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))
vi.mock('@/components/CreateOpportunityModal', () => ({ default: () => null }))
vi.mock('@/components/ApplyToOpportunityModal', () => ({ default: () => null }))
vi.mock('@/components/OpportunityDetailView', () => ({ default: () => null }))
vi.mock('@/components/PublishConfirmationModal', () => ({ default: () => null }))
vi.mock('@/components/DeleteOpportunityModal', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null,
}))

import OpportunitiesTab from '@/components/OpportunitiesTab'

function role(id: string, title: string, status: 'open' | 'closed' | 'draft') {
  return {
    id,
    title,
    status,
    club_id: 'club-1',
    opportunity_type: 'player',
    position: 'defender',
    gender: 'Women',
    location_city: 'Rosario',
    location_country: 'Argentina',
    application_deadline: null,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    published_at: '2026-09-01T12:00:00Z',
    closed_at: status === 'closed' ? '2026-10-01T12:00:00Z' : null,
    closed_reason: status === 'closed' ? 'filled' : null,
    applicant_count: 3,
  }
}

async function openMenuFor(title: string) {
  const heading = await screen.findByRole('heading', { name: title })
  const card = heading.closest('div.rounded-xl') as HTMLElement
  await userEvent.click(within(card).getByRole('button', { name: 'Open opportunity menu' }))
  return card
}

describe('Delete a role with a signing — desktop Opportunities tab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-09T12:00:00Z') })
    fx.roles = [role('opp-signed', 'Signed role', 'closed'), role('opp-plain', 'Plain role', 'closed')]
    fx.signingRows = [{ opportunity_id: 'opp-signed' }]
    fx.signingQuery = []
    fx.deleteError = null
    fx.deleted = []
    addToast.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks only for signed / waiting-to-confirm applications of closed and draft roles', async () => {
    render(<MemoryRouter><OpportunitiesTab profileId="club-1" /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Signed role' })
    await waitFor(() => expect(fx.signingQuery).toHaveLength(2))
    expect(fx.signingQuery[0]).toEqual(['opportunity_id', ['opp-signed', 'opp-plain']])
    expect(fx.signingQuery[1]).toEqual(['status', [...SIGNING_LOCK_STATUSES]])
  })

  it('disables "Delete permanently" with the founder sentence on a role with a signing', async () => {
    render(<MemoryRouter><OpportunitiesTab profileId="club-1" /></MemoryRouter>)
    await waitFor(() => expect(fx.signingQuery).toHaveLength(2))
    const card = await openMenuFor('Signed role')
    const del = within(card).getByRole('button', { name: 'Delete permanently' })
    expect(del).toBeDisabled()
    expect(within(card).getByText(ROLE_HAS_SIGNING_MESSAGE)).toBeInTheDocument()
    // Reopen stays available on the closed role.
    expect(within(card).getByRole('button', { name: 'Reopen opportunity' })).toBeEnabled()
  })

  it('keeps "Delete permanently" on a closed role without a signing', async () => {
    render(<MemoryRouter><OpportunitiesTab profileId="club-1" /></MemoryRouter>)
    await waitFor(() => expect(fx.signingQuery).toHaveLength(2))
    const card = await openMenuFor('Plain role')
    expect(within(card).getByRole('button', { name: 'Delete permanently' })).toBeEnabled()
    expect(within(card).queryByText(ROLE_HAS_SIGNING_MESSAGE)).toBeNull()
  })

  it('maps a server refusal to the founder sentence, not the generic failure', async () => {
    fx.signingRows = [] // the client didn't know (e.g. signed after the list loaded)
    fx.deleteError = {
      code: 'P0001',
      message: "This role has a confirmed signing, so it can't be deleted. Close it instead.",
    }
    render(<MemoryRouter><OpportunitiesTab profileId="club-1" /></MemoryRouter>)
    await waitFor(() => expect(fx.signingQuery).toHaveLength(2))
    const card = await openMenuFor('Plain role')
    await userEvent.click(within(card).getByRole('button', { name: 'Delete permanently' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(ROLE_HAS_SIGNING_MESSAGE, 'info'))
    expect(fx.deleted).toEqual(['opp-plain'])
    expect(addToast).not.toHaveBeenCalledWith('Failed to delete opportunity. Please try again.', 'error')
    // The menu now shows the delete as off for that role.
    const again = await openMenuFor('Plain role')
    expect(within(again).getByRole('button', { name: 'Delete permanently' })).toBeDisabled()
  })
})

describe('isRoleHasSigningError', () => {
  it('matches the trigger message with either apostrophe, nothing else', () => {
    expect(isRoleHasSigningError({ message: "This role has a confirmed signing, so it can't be deleted. Close it instead." })).toBe(true)
    expect(isRoleHasSigningError({ message: 'This role has a confirmed signing, so it can’t be deleted. Close it instead.' })).toBe(true)
    expect(isRoleHasSigningError({ message: 'permission denied for table opportunities' })).toBe(false)
    expect(isRoleHasSigningError(null)).toBe(false)
  })
})

describe('Phone Club v2 role menu', () => {
  it('offers no delete action', () => {
    const src = readFileSync(resolve(__dirname, '..', 'components', 'club', 'RoleActions.tsx'), 'utf-8')
    expect(src).not.toMatch(/\.delete\(/)
    expect(src).not.toMatch(/Delete/)
  })
})
