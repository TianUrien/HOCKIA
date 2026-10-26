/**
 * Design audit 2026-10-21, B1: desktop Community uses the phone card anatomy.
 * Photo-first person cards (name / role · team / flags + EU · age · city),
 * empty lines hidden, no "Nationality not listed", no availability chips over
 * faces, and clubs as full-width cards in a responsive grid.
 */
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'viewer' }, profile: { id: 'viewer', role: 'club' } }; return sel ? sel(s) : s } }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', common_name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }, { id: 2, name: 'Spain', common_name: 'Spain', code: 'ES', flag_emoji: '🇪🇸' }] }),
  isEuCountryCode: (c: string) => c === 'ES',
}))
vi.mock('@/hooks/useMemberAges', () => ({ useMemberAges: () => new Map([['p1', 24]]) }))
vi.mock('@/hooks/useMemberPhotos', () => ({ useMemberPhotosBatch: () => ({ photos: new Map(), isPending: () => false }) }))
vi.mock('@/hooks/useOpenRoleCounts', () => ({ useOpenRolePositions: () => new Map() }))
vi.mock('@/hooks/useClubCrestColors', () => ({ useClubCrestColors: () => new Map() }))
vi.mock('@/hooks/useFriendsInCommonBatch', () => ({ prefetchFriendsInCommon: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useBlockedUsers', () => ({ notifyBlockListChanged: vi.fn() }))
vi.mock('@/hooks/friendshipEdgeCache', () => ({ invalidateFriendshipEdges: vi.fn() }))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getPlayerLeagueName: () => null }))
vi.mock('@/lib/publicProfileCache', () => ({ rememberBlockedPair: vi.fn() }))
vi.mock('@/lib/squircle', () => ({ useSquircle: vi.fn() }))

import { MemberPhotoGrid } from '@/components/community/photo/MemberPhotoGrid'
import type { Profile } from '@/components/community/PeopleListView'

const person = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id, full_name: name, role: 'player', avatar_url: null, position: 'midfielder', playing_category: 'adult_women',
  nationality_country_id: null, nationality2_country_id: null, base_location: null, base_country_id: null,
  current_club: null, current_world_club_id: null, open_to_play: true,
  ...extra,
} as unknown as Profile)

const members = [
  person('p1', 'Ana Ruiz', { nationality_country_id: 1, nationality2_country_id: 2, base_location: 'Buenos Aires', base_country_id: 1 }),
  person('p2', 'Bea Soto'),
  { ...person('c1', 'Old Lions HC'), role: 'club', open_role_count: 1 } as unknown as Profile,
  person('p3', 'Cata Vidal'),
]

describe('Community grid (phone card anatomy on every screen size)', () => {
  it('is responsive from 1024 px: four per row up to 1439, five from 1440 (rebrand page 27)', () => {
    render(<MemberPhotoGrid members={members} />)
    const grid = screen.getByTestId('community-photo-grid')
    expect(grid.className).toContain('grid-cols-2')
    expect(grid.className).toContain('lg:grid-cols-4')
    expect(grid.className).toContain('min-[1440px]:grid-cols-5')
    expect(grid.className).not.toContain('xl:grid-cols-5')
  })

  it('clubs are full-width wide cards, never small tiles between people', () => {
    render(<MemberPhotoGrid members={members} />)
    const clubs = screen.getAllByTestId('community-club-wide')
    expect(clubs).toHaveLength(1)
    expect(clubs[0].className).toContain('col-span-full')
    expect(within(clubs[0]).getByText('Old Lions HC')).toBeInTheDocument()
    expect(within(clubs[0]).getByText('Recruiting now')).toBeInTheDocument()
  })

  it('person cards: name / role · team / flags + EU · age · city', () => {
    render(<MemberPhotoGrid members={members} />)
    const ana = screen.getAllByTestId('member-tile').find((el) => el.textContent?.includes('Ana Ruiz'))!
    expect(ana.textContent).toContain('Midfielder · Women’s')
    expect(ana.textContent).toContain('EU')
    expect(ana.textContent).toContain('24 · Buenos Aires')
  })

  it('hides empty lines: no nationality or place line, no "Nationality not listed", no chips over faces', () => {
    render(<MemberPhotoGrid members={members} />)
    const bea = screen.getAllByTestId('member-tile').find((el) => el.textContent?.includes('Bea Soto'))!
    const lines = bea.querySelectorAll('span.truncate')
    expect([...lines].map((l) => l.textContent)).toEqual(['Bea Soto', 'Midfielder · Women’s'])
    expect(screen.queryByText(/Nationality not listed/)).toBeNull()
    expect(screen.queryByText(/Open to play|Open to coach/)).toBeNull()
  })

  it('desktop Community renders this grid, not the legacy tile', () => {
    const plv = readFileSync(resolve(__dirname, '../components/community/PeopleListView.tsx'), 'utf8')
    expect(plv).toContain('<MemberPhotoGrid')
    expect(plv).not.toMatch(/RecruiterCandidateCard|MemberPreviewModal|CandidatePreviewSheet/)
  })
})
