/**
 * Player alignment round 1 — Profile (Figma 04 · Player — Live 313:1016):
 * Tag / Meta pills under the name, Add friend Primary + Message Secondary on
 * the phone public view, Card / Reference (gold border, 4-line quote,
 * day-first date), Detail-row-shaped career rows without the "Now" pill.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const friendship = { isFriend: false, isOutgoingRequest: false, isIncomingRequest: false, mutating: false, sendRequest: vi.fn(async () => {}), acceptRequest: vi.fn(async () => {}) }
vi.mock('@/hooks/useFriendship', () => ({ useFriendship: () => friendship }))
vi.mock('@/hooks/useCoverPhoto', () => ({ useCoverPhoto: () => null }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
vi.mock('@/components/SettingsSheet', () => ({ default: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'viewer-1' }, profile: { id: 'viewer-1', role: 'player' } }; return sel ? sel(s) : s } }))
vi.mock('@/components', () => ({
  Avatar: () => <div />,
  DualNationalityDisplay: ({ fallbackText }: { fallbackText?: string | null }) => <span>{fallbackText ?? ''}</span>,
  LastActivePill: () => null,
  VerifiedBadge: () => null,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({}) }), rpc: async () => ({ data: null, error: null }) } }))

import HeroIdentityCard from '@/components/dashboard/bento/HeroIdentityCard'
import { CareerRow, ReferenceCard } from '@/components/profile/mobile/ProfileLongScroll'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

const player = {
  id: 'p1', role: 'player', full_name: 'Val Turienzo', position: 'midfielder', secondary_position: null,
  current_club: 'Bayside Saints', current_world_club_id: null, specialist_skills: ['drag_flicker'], brand_representation: 'Grays',
  open_to_play: true, nationality: 'Argentina', base_location: 'Bentleigh',
} as unknown as PlayerProfileShape

describe('Profile hero on the phone (d2)', () => {
  it('shows club, specialist skill and brand as Tag / Meta pills', () => {
    render(<MemoryRouter><HeroIdentityCard profile={player} readOnly isOwnProfile={false} d2 onMessage={() => {}} /></MemoryRouter>)
    const pills = screen.getAllByTestId('meta-pill')
    expect(pills.map((p) => [p.textContent, p.getAttribute('data-icon'), p.getAttribute('data-tone')])).toEqual([
      ['Bayside Saints', 'club', 'neutral'],
      ['Drag flicker', 'position', 'neutral'],
      ['Grays', 'specialist', 'brand'],
    ])
  })
  it('Add friend is the Primary (with plus), Message the Secondary', () => {
    render(<MemoryRouter><HeroIdentityCard profile={player} readOnly isOwnProfile={false} d2 onMessage={() => {}} /></MemoryRouter>)
    const add = screen.getByTestId('hero-add-friend')
    expect(add).toHaveTextContent('Add friend')
    expect(add.className).toContain('bg-hockia-primary')
    expect(add.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus')
    const msg = screen.getByTestId('hero-message')
    expect(msg.className).toContain('ring-line')
    expect(msg.className).toContain('bg-white')
  })
  it('desktop (no d2) keeps the legacy pills and buttons', () => {
    render(<MemoryRouter><HeroIdentityCard profile={player} readOnly isOwnProfile={false} onMessage={() => {}} /></MemoryRouter>)
    expect(screen.queryAllByTestId('meta-pill')).toHaveLength(0)
    expect(screen.queryByTestId('hero-add-friend')).toBeNull()
  })
})

describe('Card / Reference', () => {
  const ref = {
    id: 'r1', relationshipType: 'teammate', endorsementText: 'A natural leader.', acceptedAt: '2026-03-12T10:00:00Z',
    profile: { id: 'a1', fullName: 'Nico Lamas', role: 'coach', avatarUrl: null, position: null, currentClub: 'Sociedad' },
  } as never
  it('has the gold border, a 4-line quote and a day-first date', () => {
    render(<ReferenceCard reference={ref} onOpen={() => {}} />)
    const card = screen.getByTestId('reference-card')
    expect(card.className).toContain('border-gold-line')
    expect(screen.getByTestId('reference-quote').className).toContain('line-clamp-4')
    expect(screen.getByText(/Verified · written on Hockia/).className).toContain('text-gold')
    expect(screen.getByText('12 Mar 2026')).toBeInTheDocument()
  })
})

describe('List item / Career', () => {
  it('current club reads "– now" in the date line, without a Now pill', () => {
    const entry = { id: 'c1', clubName: 'Holcombe', entryType: 'club', startDate: '2025-07-01', endDate: null, years: null, positionRole: 'defender', divisionLeague: null, locationCity: 'London', locationCountry: 'England', worldClub: null, signedViaHockia: false, representedCountryId: null } as never
    render(<CareerRow entry={entry} last flag={null} />)
    expect(screen.getByText(/Jul 2025 – now/)).toBeInTheDocument()
    expect(screen.queryByText('Now')).toBeNull()
  })
})
