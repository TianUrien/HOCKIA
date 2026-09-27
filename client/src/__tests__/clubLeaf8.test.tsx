/**
 * Club v2 leaf 8 — the club's view of a player profile (Figma D1.16 352:450)
 * and Community in club view (D1.17 352:995). Pure helpers first, then the
 * fit chip on the member card, the "Players · Best fit / Ranked for" header,
 * and Add friend moving into the "…" menu on the club view of a profile.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clubViewSortOptions, rankCommunityClubView } from '@/lib/communityClubView'

// ── mocks for the rendered components ─────────────────────────────────────
const scouting = {
  ctx: null as null | Record<string, unknown>,
  contexts: [] as Record<string, unknown>[],
  openRoles: [] as { id: string }[],
  roles: new Map<string, { title: string; toReview: number }>(),
  activate: vi.fn(async () => {}),
  clearActive: vi.fn(async () => {}),
}
vi.mock('@/hooks/useScouting', () => ({ useScoutingContext: () => scouting }))

const menuItems: { key: string; label: string; disabled?: boolean; onSelect: () => void }[][] = []
vi.mock('@/components/ProfileActionMenu', () => ({
  default: ({ leadingItems = [] }: { leadingItems?: { key: string; label: string; disabled?: boolean; onSelect: () => void }[] }) => {
    menuItems.push(leadingItems)
    return <div data-testid="profile-more-menu">{leadingItems.map((i) => <button key={i.key} type="button" onClick={i.onSelect}>{i.label}</button>)}</div>
  },
}))
const friendship = { isFriend: false, isOutgoingRequest: false, isIncomingRequest: false, mutating: false, sendRequest: vi.fn(async () => {}), acceptRequest: vi.fn(async () => {}) }
vi.mock('@/hooks/useFriendship', () => ({ useFriendship: () => friendship }))
vi.mock('@/hooks/useCoverPhoto', () => ({ useCoverPhoto: () => null }))
vi.mock('@/components/SettingsSheet', () => ({ default: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club' } }; return sel ? sel(s) : s } }))
vi.mock('@/components', () => ({
  Avatar: () => <div />,
  DualNationalityDisplay: ({ fallbackText }: { fallbackText?: string | null }) => <span>{fallbackText ?? ''}</span>,
  LastActivePill: () => null,
  VerifiedBadge: () => null,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({}) }), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/hooks/useOpenRoleCounts', () => ({ openRolesLabel: () => null, useOpenRoleCounts: () => new Map() }))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getPlayerLeagueName: () => null, useWorldClubLogo: () => null }))

import RecruiterCandidateCard from '@/components/recruiting/RecruiterCandidateCard'
import { ClubViewPlayersHeader } from '@/components/community/ClubViewPlayersHeader'
import HeroIdentityCard from '@/components/dashboard/bento/HeroIdentityCard'

beforeEach(() => {
  scouting.ctx = null
  scouting.contexts = []
  scouting.openRoles = []
  menuItems.length = 0
  friendship.isFriend = false
  friendship.isOutgoingRequest = false
  friendship.isIncomingRequest = false
  friendship.sendRequest.mockClear()
})

// ── ranking (DEV NOTE 355:905 → same order as Find players) ───────────────
describe('Community club view ranking', () => {
  const m = (id: string, p: Partial<{ open_to_play: boolean; full_game_video_count: number; career_entry_count: number; last_active_at: string }> = {}) => ({ id, role: 'player', ...p })
  it('puts open-to-play first, then fit score, then evidence', () => {
    const members = [m('closed-strong', { open_to_play: false }), m('open-weak', { open_to_play: true }), m('open-strong', { open_to_play: true })]
    const fit = new Map([
      ['closed-strong', { state: 'green' as const, score: 0.95 }],
      ['open-weak', { state: 'yellow' as const, score: 0.5 }],
      ['open-strong', { state: 'green' as const, score: 0.9 }],
    ])
    expect(rankCommunityClubView(members, fit, new Map(), { byFit: true }).map((r) => r.id)).toEqual(['open-strong', 'open-weak', 'closed-strong'])
  })
  it('breaks fit ties by full matches, then highlights, then career', () => {
    const members = [m('career', { open_to_play: true, career_entry_count: 5 }), m('hl', { open_to_play: true }), m('fm', { open_to_play: true, full_game_video_count: 1 })]
    const fit = new Map(members.map((x) => [x.id, { state: 'yellow' as const, score: 0.6 }]))
    expect(rankCommunityClubView(members, fit, new Map([['hl', 3]]), { byFit: true }).map((r) => r.id)).toEqual(['fm', 'hl', 'career'])
  })
  it('ranks by evidence only when fit is off (no context or no league level)', () => {
    const members = [m('fit-only', { open_to_play: true }), m('proof', { open_to_play: true, full_game_video_count: 2 })]
    const fit = new Map([['fit-only', { state: 'green' as const, score: 0.99 }]])
    expect(rankCommunityClubView(members, fit, new Map(), { byFit: false }).map((r) => r.id)).toEqual(['proof', 'fit-only'])
  })
  it('labels the default sort "Best fit" only while a player context ranks the grid', () => {
    expect(clubViewSortOptions(true).map((o) => o.label)).toEqual(['Best fit', 'Strongest evidence', 'Most complete'])
    expect(clubViewSortOptions(false)[0].label).toBe('Newest')
  })
})

// ── fit chip on the member card (DEV NOTE 355:905) ─────────────────────────
describe('member card fit chip', () => {
  const member = { id: 'p1', avatar_url: null, full_name: 'Leandro Bica', role: 'player' as const, position: 'midfielder', nationality: 'Argentina', current_club: null, open_to_play: true }
  it('shows green "Strong fit" and yellow "Possible fit"', () => {
    const { rerender } = render(<RecruiterCandidateCard member={member} fitState="green" onPreview={() => {}} />)
    expect(screen.getByText('Strong fit')).toBeInTheDocument()
    expect(screen.getByText('Open to play')).toBeInTheDocument()
    expect(screen.getByText('Player · Midfielder')).toBeInTheDocument()
    rerender(<RecruiterCandidateCard member={member} fitState="yellow" onPreview={() => {}} />)
    expect(screen.getByText('Possible fit')).toBeInTheDocument()
  })
  it('shows nothing for a grey fit or when no fit is passed (players never get one)', () => {
    const { rerender } = render(<RecruiterCandidateCard member={member} fitState="grey" onPreview={() => {}} />)
    expect(screen.queryByTestId('fit-chip')).toBeNull()
    rerender(<RecruiterCandidateCard member={member} onPreview={() => {}} />)
    expect(screen.queryByTestId('fit-chip')).toBeNull()
  })
  it('tapping the card calls onPreview (club view passes "open the profile")', () => {
    const open = vi.fn()
    render(<RecruiterCandidateCard member={member} fitState="green" onPreview={open} />)
    fireEvent.click(screen.getByTestId('member-tile'))
    expect(open).toHaveBeenCalledTimes(1)
  })
})

// ── header: Players · Best fit · Ranked for (D1.17) ───────────────────────
describe('ClubViewPlayersHeader', () => {
  it('shows Players, "Best fit" and the active role in the Ranked for pill', () => {
    scouting.ctx = { id: 'c1', type: 'opportunity', label: 'Men’s 1st', target_category: 'Men', target_position: 'midfielder', target_role: 'player', opportunity_id: 'o1' }
    scouting.contexts = [scouting.ctx]
    scouting.openRoles = [{ id: 'o1' }]
    render(<ClubViewPlayersHeader sort="newest" onSort={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Players' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Best fit' })).toBeInTheDocument()
    expect(screen.getByTestId('ranked-for-pill')).toHaveTextContent("Midfielder · Men's")
  })
  it('reads "No context" and "Newest" without a context, and the pill opens Recruiting for', () => {
    render(<ClubViewPlayersHeader sort="newest" onSort={() => {}} />)
    expect(screen.getByTestId('ranked-for-pill')).toHaveTextContent('No context')
    expect(screen.getByRole('option', { name: 'Newest' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ranked-for-pill'))
    expect(screen.getByRole('radiogroup', { name: 'Recruiting for' })).toBeInTheDocument()
  })
  it('changing the sort reports the new value', () => {
    const onSort = vi.fn()
    render(<ClubViewPlayersHeader sort="newest" onSort={onSort} />)
    fireEvent.change(screen.getByTestId('club-view-sort'), { target: { value: 'evidence' } })
    expect(onSort).toHaveBeenCalledWith('evidence')
  })
})

// ── profile in club view: Add friend moves into "…" (DEV NOTE 355:899) ─────
describe('player profile — club view', () => {
  const profile = { id: 'p1', role: 'player', full_name: 'Leandro Bica', username: null, position: 'midfielder', secondary_position: null, playing_category: 'adult_men', open_to_play: true } as unknown as Parameters<typeof HeroIdentityCard>[0]['profile']
  const renderHero = (recruiterActions: Parameters<typeof HeroIdentityCard>[0]['recruiterActions']) => render(
    <MemoryRouter>
      <HeroIdentityCard profile={profile} readOnly isOwnProfile={false} d2 recruiterActions={recruiterActions} onMessage={() => {}} />
    </MemoryRouter>,
  )
  it('Shortlist + Message are the buttons; Add friend sits in the … menu', () => {
    renderHero({ onShortlist: () => {}, shortlisted: false })
    expect(screen.getByRole('button', { name: /Shortlist/ })).toBeInTheDocument()
    const menu = screen.getByTestId('profile-more-menu')
    expect(menu).toHaveTextContent('Add friend')
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }))
    expect(friendship.sendRequest).toHaveBeenCalled()
  })
  it('a pending request reads "Friend request sent" (disabled); friends get no item', () => {
    friendship.isOutgoingRequest = true
    const { unmount } = renderHero({ onShortlist: () => {}, shortlisted: false })
    expect(menuItems.at(-1)?.[0]).toMatchObject({ label: 'Friend request sent', disabled: true })
    unmount()
    friendship.isOutgoingRequest = false
    friendship.isFriend = true
    renderHero({ onShortlist: () => {}, shortlisted: false })
    expect(menuItems.at(-1)).toEqual([])
  })
  it('players and the owner preview keep the menu as it was (no friend item)', () => {
    renderHero(null)
    expect(menuItems.at(-1)).toEqual([])
    renderHero({ onShortlist: () => {}, shortlisted: false, preview: true })
    expect(menuItems.at(-1)).toEqual([])
  })
})
