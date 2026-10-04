/**
 * Player alignment round 1 — Community (Figma 313:2304, Card / Member
 * 501:6648): fit is hidden for players, the status pill reads "Open to play"
 * or "Recruiting" (never a count), and a club's second line is its league on
 * Hockia, else its location.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { role: 'player' as string }
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'v1' }, profile: { id: 'v1', role: auth.role } }; return sel ? sel(s) : s } }))
vi.mock('@/components', () => ({ DualNationalityDisplay: ({ fallbackText }: { fallbackText?: string | null }) => <span>{fallbackText ?? ''}</span> }))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getPlayerLeagueName: (id: string | null) => (id === 'wc-lazio' ? 'Serie A Elite' : null) }))

import RecruiterCandidateCard from '@/components/recruiting/RecruiterCandidateCard'

const player = { id: 'p1', avatar_url: null, full_name: 'Leandro Bica', role: 'player' as const, position: 'midfielder', nationality: 'Argentina', current_club: null, open_to_play: true }
const club = { id: 'c1', avatar_url: null, full_name: 'Lazio Hockey', role: 'club' as const, nationality: 'Italy', current_club: null, base_location: 'Rome, Italy', open_to_opportunities: true }
const verdict = { tier: 'strong', strength: 0.9, caveats: [] } as never

beforeEach(() => { auth.role = 'player' })

describe('Card / Member for a player viewer', () => {
  it('hides fit chips and match % even when a caller passes them', () => {
    const { rerender } = render(<RecruiterCandidateCard member={player} fitState="green" onPreview={() => {}} />)
    expect(screen.queryByTestId('fit-chip')).toBeNull()
    expect(screen.queryByText('Strong fit')).toBeNull()
    rerender(<RecruiterCandidateCard member={player} verdict={verdict} onPreview={() => {}} />)
    expect(screen.queryByText(/% ?$/)).toBeNull()
    expect(screen.queryByText(/match/)).toBeNull()
    expect(screen.getByText('Open to play')).toBeInTheDocument()
  })
  it('a club viewer still sees the fit chip (club-only surface)', () => {
    auth.role = 'club'
    render(<RecruiterCandidateCard member={player} fitState="green" onPreview={() => {}} />)
    expect(screen.getByText('Strong fit')).toBeInTheDocument()
  })
})

describe('status pill and club line', () => {
  it('a club with open roles reads "Recruiting", never a count', () => {
    render(<RecruiterCandidateCard member={{ ...club, open_role_count: 3 }} onPreview={() => {}} />)
    expect(screen.getByText('Recruiting')).toBeInTheDocument()
    expect(screen.queryByText(/open role/)).toBeNull()
  })
  it('a club with no open role has no pill (a stale toggle is not recruiting)', () => {
    render(<RecruiterCandidateCard member={{ ...club, open_role_count: 0 }} onPreview={() => {}} />)
    expect(screen.queryByText('Recruiting')).toBeNull()
  })
  it('club second line = league on Hockia, else location', () => {
    const { rerender } = render(<RecruiterCandidateCard member={{ ...club, current_world_club_id: 'wc-lazio' }} onPreview={() => {}} />)
    expect(screen.getByText('Club · Serie A Elite')).toBeInTheDocument()
    rerender(<RecruiterCandidateCard member={{ ...club, year_founded: 1990 }} onPreview={() => {}} />)
    expect(screen.getByText('Club · Rome, Italy')).toBeInTheDocument()
  })
})

describe('Community segments (phone)', () => {
  it('the selected segment is soft purple on the phone (Chip ruling); desktop keeps ink', async () => {
    Element.prototype.scrollIntoView = () => {}
    const { MemoryRouter } = await import('react-router-dom')
    const { CommunitySegments } = await import('@/components/community/CommunitySegments')
    render(<MemoryRouter initialEntries={['/community']}><CommunitySegments activeTab="all" /></MemoryRouter>)
    const sel = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!
    expect(sel.className).toContain('bg-brand-soft')
    expect(sel.className).toContain('text-brand-primary')
    expect(sel.className).toContain('lg:bg-ink-1')
  })
})
