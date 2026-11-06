/**
 * Community candidate card — avatar fallback regression.
 *
 * 2026-07-30, seen on prod: a player whose profile row pointed at a deleted
 * storage file showed the browser's broken-image glyph ("?" box) on the
 * Community grid, while a player with NO avatar at all showed clean initials.
 * A broken avatar looked worse than a missing one, on the most-viewed
 * discovery surface.
 *
 * Cause: this card renders a raw <img> with no onError handler, bypassing the
 * shared Avatar component's fallback. Fix: a failed load is treated as "no
 * image" and takes the same fallback path.
 *
 * 2026-11-06: the fallback is Avatar / Placeholder for the member's role, never
 * initials (founder 2026-10-26).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RecruiterCandidateCard, { type RecruiterCardMember } from '@/components/recruiting/RecruiterCandidateCard'

// The card imports the @/components barrel, which transitively pulls in
// lib/supabase — and that module THROWS at import when Supabase env vars are
// absent. CI's unit job has no env (the vars come from a gitignored root
// .env.local locally), so without this mock the whole file fails to load
// there while passing on any dev machine.
vi.mock('@/lib/supabase', () => {
  // Chainable no-op builder: any query method returns the builder, and
  // awaiting it yields an empty result. Keeps this test independent of
  // whatever the barrel's transitive imports happen to query.
  const builder: Record<string, unknown> = {}
  const chain = new Proxy(builder, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      return () => chain
    },
  })
  return {
    supabase: {
      from: () => chain,
      rpc: () => chain,
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  }
})

vi.mock('@/hooks/useWorldClubLogo', () => ({
  getPlayerLeagueName: () => null,
  prefetchWorldClubLogos: vi.fn(),
  getClubLevelBand: () => null,
}))

const member: RecruiterCardMember = {
  id: 'p1',
  avatar_url: 'https://x.supabase.co/storage/v1/object/public/avatars/p1/deleted.jpg',
  full_name: 'Octavio Pereyra',
  role: 'player',
  position: 'forward',
  nationality: 'Argentina',
  current_club: null,
}

function renderCard(overrides: Partial<RecruiterCardMember> = {}) {
  return render(
    <MemoryRouter>
      <RecruiterCandidateCard member={{ ...member, ...overrides }} onPreview={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('RecruiterCandidateCard avatar fallback', () => {
  it('falls back to the role placeholder when the avatar URL fails to load', () => {
    const { container } = renderCard()

    // Before the error the <img> is present…
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(screen.queryByText('OP')).not.toBeInTheDocument()

    // …a dead URL fires onError, and the card must show the placeholder, NOT
    // a broken-image glyph (i.e. no <img> left in the DOM) or initials.
    fireEvent.error(img!)

    expect(screen.getByTestId('role-placeholder')).toHaveAttribute('data-role', 'player')
    expect(screen.queryByText('OP')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the role placeholder, never initials, when there is no avatar at all', () => {
    const { container } = renderCard({ avatar_url: null })
    expect(screen.getByTestId('role-placeholder')).toHaveAttribute('data-role', 'player')
    expect(screen.queryByText('OP')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('uses the member role for the placeholder (a coach gets the coach one)', () => {
    renderCard({ avatar_url: null, role: 'coach' })
    expect(screen.getByTestId('role-placeholder')).toHaveAttribute('data-role', 'coach')
  })

  it('keeps rendering the image while it loads fine', () => {
    const { container } = renderCard()
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByText('OP')).not.toBeInTheDocument()
  })
})
