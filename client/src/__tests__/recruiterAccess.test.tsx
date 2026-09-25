/**
 * Player-rule leaks (Phase 1 · step 4) — who counts as a recruiter, and the
 * route guard on the Save / shortlist pages.
 *
 * Founder rule 2026-09-25: Save is for clubs and coaches who recruit for a
 * team only. Players and candidate coaches never reach /dashboard/saved or
 * /dashboard/shortlists (old bookmarks bounce to their own profile).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

type Viewer = { id: string; role: string; coach_recruits_for_team?: boolean | null } | null
const authState: { profile: Viewer; profileStatus: string } = { profile: null, profileStatus: 'idle' }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}))

import { isRecruitingViewer } from '@/lib/recruiterAccess'
import RecruiterOnlyRoute from '@/components/RecruiterOnlyRoute'

describe('isRecruitingViewer', () => {
  it('is true for clubs and recruiting coaches only', () => {
    expect(isRecruitingViewer({ role: 'club' })).toBe(true)
    expect(isRecruitingViewer({ role: 'coach', coach_recruits_for_team: true })).toBe(true)
  })

  it('is false for players, candidate coaches, umpires, brands and nobody', () => {
    expect(isRecruitingViewer({ role: 'player' })).toBe(false)
    expect(isRecruitingViewer({ role: 'coach', coach_recruits_for_team: false })).toBe(false)
    expect(isRecruitingViewer({ role: 'coach', coach_recruits_for_team: null })).toBe(false)
    expect(isRecruitingViewer({ role: 'coach' })).toBe(false)
    expect(isRecruitingViewer({ role: 'umpire' })).toBe(false)
    expect(isRecruitingViewer({ role: 'brand' })).toBe(false)
    expect(isRecruitingViewer(null)).toBe(false)
    expect(isRecruitingViewer(undefined)).toBe(false)
  })
})

describe('RecruiterOnlyRoute', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/saved" element={<RecruiterOnlyRoute><div data-testid="saved-page" /></RecruiterOnlyRoute>} />
          <Route path="/dashboard/shortlists" element={<RecruiterOnlyRoute><div data-testid="shortlists-page" /></RecruiterOnlyRoute>} />
          <Route path="/dashboard/profile" element={<div data-testid="own-profile" />} />
        </Routes>
      </MemoryRouter>,
    )

  beforeEach(() => {
    authState.profile = null
    authState.profileStatus = 'loaded'
  })

  it('bounces a player from /dashboard/saved to their own profile', () => {
    authState.profile = { id: 'p1', role: 'player' }
    renderAt('/dashboard/saved')
    expect(screen.queryByTestId('saved-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('own-profile')).toBeInTheDocument()
  })

  it('bounces a candidate coach from /dashboard/shortlists', () => {
    authState.profile = { id: 'c1', role: 'coach', coach_recruits_for_team: false }
    renderAt('/dashboard/shortlists')
    expect(screen.queryByTestId('shortlists-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('own-profile')).toBeInTheDocument()
  })

  it('lets a club and a recruiting coach through', () => {
    authState.profile = { id: 'club1', role: 'club' }
    const { unmount } = renderAt('/dashboard/saved')
    expect(screen.getByTestId('saved-page')).toBeInTheDocument()
    unmount()

    authState.profile = { id: 'c2', role: 'coach', coach_recruits_for_team: true }
    renderAt('/dashboard/shortlists')
    expect(screen.getByTestId('shortlists-page')).toBeInTheDocument()
  })

  it('renders nothing (no bounce) while the profile is still loading', () => {
    authState.profile = null
    authState.profileStatus = 'fetching'
    const { container } = renderAt('/dashboard/saved')
    expect(container).toBeEmptyDOMElement()
  })
})
