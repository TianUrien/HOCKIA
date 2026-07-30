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
 * image" and takes the same initials path.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RecruiterCandidateCard, { type RecruiterCardMember } from '@/components/recruiting/RecruiterCandidateCard'

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
  it('falls back to initials when the avatar URL fails to load', () => {
    const { container } = renderCard()

    // Before the error the <img> is present…
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(screen.queryByText('OP')).not.toBeInTheDocument()

    // …a dead URL fires onError, and the card must show initials, NOT a
    // broken-image glyph (i.e. no <img> left in the DOM).
    fireEvent.error(img!)

    expect(screen.getByText('OP')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows initials directly when there is no avatar at all', () => {
    const { container } = renderCard({ avatar_url: null })
    expect(screen.getByText('OP')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps rendering the image while it loads fine', () => {
    const { container } = renderCard()
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByText('OP')).not.toBeInTheDocument()
  })
})
