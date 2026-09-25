/**
 * Player-rule leaks (Phase 1 · step 4) — Community member preview.
 * Only recruiters (clubs + coaches who recruit for a team) get the
 * recruiter preview with the Evidence tier; a candidate coach or a player
 * gets the plain half-sheet (Passports · Club · Based, no Evidence).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })), rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}))
type Viewer = { user: { id: string } | null; profile: { id: string; role: string; coach_recruits_for_team?: boolean } | null }
const authState: Viewer = { user: null, profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
}))
vi.mock('@/hooks/useSavedProfiles', () => ({
  useIsProfileSaved: () => ({ isSaved: false, mutating: false, isAuthenticated: true, isOwnProfile: false, toggle: vi.fn() }),
}))
vi.mock('@/hooks/useWorldClubLogo', () => ({ useWorldClubLogo: () => null, getClubLevelBand: () => null }))
vi.mock('@/components/recruiting/QuickActionsRow', () => ({ default: () => null }))
vi.mock('@/components/recruiting/ClubFitChip', () => ({ default: () => null }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackProtectedActionBlocked: vi.fn() }))
vi.mock('@/components/community/MemberPreviewSheet', () => ({
  MemberPreviewSheet: () => <div data-testid="member-preview-sheet" />,
}))

import { MemberPreviewModal } from '@/components/community/MemberPreviewModal'
import type { Profile } from '@/components/community/PeopleListView'

const member = {
  id: 'player-9',
  role: 'player',
  full_name: 'Jordan Hall',
  avatar_url: null,
  highlight_video_url: 'https://example.test/v',
  full_game_video_count: 2,
  accepted_reference_count: 3,
  is_verified: true,
  current_world_club_id: null,
} as unknown as Profile

const setViewer = (role: string, recruits = false) => {
  authState.user = { id: 'viewer-1' }
  authState.profile = { id: 'viewer-1', role, coach_recruits_for_team: recruits }
}

const renderModal = () =>
  render(<MemoryRouter><MemberPreviewModal member={member} onClose={() => undefined} /></MemoryRouter>)

describe('MemberPreviewModal — evidence tier is recruiter-only', () => {
  it('a player gets the plain half-sheet', () => {
    setViewer('player')
    renderModal()
    expect(screen.getByTestId('member-preview-sheet')).toBeInTheDocument()
    expect(screen.queryByText(/evidence/i)).not.toBeInTheDocument()
  })

  it('a candidate coach gets the plain half-sheet, not the recruiter preview', () => {
    setViewer('coach', false)
    renderModal()
    expect(screen.getByTestId('member-preview-sheet')).toBeInTheDocument()
    expect(screen.queryByText(/evidence/i)).not.toBeInTheDocument()
  })

  it('a recruiting coach gets the recruiter preview with the Evidence block', () => {
    setViewer('coach', true)
    renderModal()
    expect(screen.queryByTestId('member-preview-sheet')).not.toBeInTheDocument()
    expect(screen.getAllByText(/evidence/i).length).toBeGreaterThan(0)
  })
})
